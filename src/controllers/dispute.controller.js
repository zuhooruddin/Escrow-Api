const Deal = require('../models/Deal');
const User = require('../models/User');
const { AuditLog } = require('../models/AuditLog');
const AppError = require('../utils/AppError');
const notificationService = require('../services/notification.service');

async function logStatusChange(deal, from, to, user, role, action, req = {}) {
  await AuditLog.create({
    deal: deal._id, fromStatus: from, toStatus: to,
    triggeredBy: user?._id || null, triggeredByRole: role,
    action, ipAddress: req.ip, timestamp: new Date(),
  });
}

// ─── RAISE DISPUTE ────────────────────────────────────────────────────────────
exports.raiseDispute = async (req, res) => {
  const { reason } = req.body;
  const deal = await Deal.findById(req.params.dealId).populate('buyer seller');
  if (!deal) throw new AppError('Deal not found.', 404);
  if (!deal.buyer._id.equals(req.user._id)) throw new AppError('Only the buyer can raise a dispute.', 403);
  if (deal.status !== 'DELIVERED') throw new AppError('Disputes can only be raised after work is delivered.', 400);
  if (!reason || reason.trim().length < 20) throw new AppError('Please provide a detailed reason (minimum 20 characters).', 400);

  const evidence = req.uploadedFiles || [];
  const prevStatus = deal.status;

  deal.status = 'DISPUTED';
  deal.disputedAt = new Date();
  deal.dispute = {
    raisedBy: req.user._id,
    buyerReason: reason.trim(),
    buyerEvidence: evidence,
  };
  await deal.save();

  await logStatusChange(deal, prevStatus, 'DISPUTED', req.user, 'buyer', `Buyer raised dispute: "${reason.substring(0, 100)}..."`, req);

  await notificationService.notifyBoth({
    deal,
    type: 'dispute_opened',
    buyerTitle: 'Dispute Submitted',
    buyerMessage: `Your dispute for deal "${deal.title}" has been submitted. Admin team will review within 48 hours.`,
    sellerTitle: 'Dispute Raised Against Your Delivery',
    sellerMessage: `The buyer raised a dispute on "${deal.title}". Funds are frozen. Please respond within ${process.env.DISPUTE_RESPONSE_DAYS || 3} days.`,
    sellerSms: { phone: deal.seller.phone, dealNumber: deal.dealNumber },
  });

  await notificationService.notifyAdmin({
    type: 'dispute_opened',
    title: '🚨 New Dispute — Action Required',
    message: `Deal ${deal.dealNumber} — Buyer raised dispute. Amount: Rs. ${(deal.amountInPaisa / 100).toLocaleString()}. Review in admin panel.`,
    deal: deal._id,
  });

  res.json({ success: true, message: 'Dispute raised. Funds are frozen. Admin team will review within 48 hours.', data: { deal } });
};

// ─── SELLER RESPOND TO DISPUTE ────────────────────────────────────────────────
exports.respondToDispute = async (req, res) => {
  const { response } = req.body;
  const deal = await Deal.findById(req.params.dealId).populate('buyer seller');
  if (!deal) throw new AppError('Deal not found.', 404);
  if (!deal.seller._id.equals(req.user._id)) throw new AppError('Only the seller can respond to this dispute.', 403);
  if (deal.status !== 'DISPUTED') throw new AppError('This deal is not in DISPUTED status.', 400);
  if (deal.dispute?.sellerResponse) throw new AppError('You have already responded to this dispute.', 400);
  if (!response || response.trim().length < 20) throw new AppError('Please provide a detailed response (minimum 20 characters).', 400);

  const evidence = req.uploadedFiles || [];
  deal.dispute.sellerResponse = response.trim();
  deal.dispute.sellerEvidence = evidence;
  deal.dispute.sellerRespondedAt = new Date();
  await deal.save();

  await logStatusChange(deal, 'DISPUTED', 'DISPUTED', req.user, 'seller', 'Seller submitted dispute response.', req);

  await notificationService.notifyAdmin({
    type: 'dispute_response',
    title: 'Seller Responded to Dispute',
    message: `Deal ${deal.dealNumber} — Seller submitted response. Both sides available for review.`,
    deal: deal._id,
  });

  res.json({ success: true, message: 'Response submitted. Admin team will review and issue a verdict.', data: { deal } });
};

// ─── ADMIN RESOLVE DISPUTE ────────────────────────────────────────────────────
exports.resolveDispute = async (req, res) => {
  if (req.user.role !== 'admin') throw new AppError('Admin access required.', 403);

  const { verdict, verdictReason, partialRefundPercent } = req.body;
  const validVerdicts = ['release_to_seller', 'partial_refund', 'full_refund_to_buyer'];
  if (!validVerdicts.includes(verdict)) throw new AppError('Invalid verdict.', 400);
  if (!verdictReason || verdictReason.trim().length < 20) throw new AppError('Verdict reason must be at least 20 characters.', 400);

  if (verdict === 'partial_refund') {
    if (!partialRefundPercent || partialRefundPercent < 1 || partialRefundPercent > 99) {
      throw new AppError('Partial refund percentage must be between 1 and 99.', 400);
    }
  }

  const deal = await Deal.findById(req.params.dealId).populate('buyer seller');
  if (!deal) throw new AppError('Deal not found.', 404);
  if (deal.status !== 'DISPUTED') throw new AppError('This deal is not in DISPUTED status.', 400);

  const prevStatus = deal.status;
  let newStatus;
  let buyerMsg, sellerMsg;

  if (verdict === 'release_to_seller') {
    newStatus = 'COMPLETED';
    deal.completedAt = new Date();
    buyerMsg = `Admin reviewed your dispute for "${deal.title}" and decided to release funds to the seller. Reason: ${verdictReason}`;
    sellerMsg = `Admin reviewed the dispute for "${deal.title}" and released your payment of Rs. ${(deal.sellerPayoutInPaisa / 100).toLocaleString()}. Payout within 24 hours.`;

    await User.findByIdAndUpdate(deal.seller._id, { $inc: { 'stats.totalDealsAsSeller': 1, 'stats.totalAmountEarned': deal.sellerPayoutInPaisa } });
  } else if (verdict === 'full_refund_to_buyer') {
    newStatus = 'REFUNDED';
    deal.refundedAt = new Date();
    buyerMsg = `Admin reviewed your dispute for "${deal.title}" and issued a full refund. Rs. ${(deal.amountInPaisa / 100).toLocaleString()} will be returned within 24 hours.`;
    sellerMsg = `Admin reviewed the dispute for "${deal.title}" and issued a full refund to the buyer. No payment will be released.`;
  } else {
    // Partial refund
    newStatus = 'REFUNDED';
    deal.refundedAt = new Date();
    const refundAmount = Math.round(deal.amountInPaisa * (partialRefundPercent / 100));
    const sellerAmount = deal.amountInPaisa - refundAmount;
    deal.dispute.partialRefundPercent = partialRefundPercent;
    buyerMsg = `Admin issued a ${partialRefundPercent}% partial refund for "${deal.title}". Rs. ${(refundAmount / 100).toLocaleString()} will be refunded.`;
    sellerMsg = `Admin issued a partial refund for "${deal.title}". You will receive Rs. ${(sellerAmount / 100).toLocaleString()}.`;
  }

  deal.status = newStatus;
  deal.dispute.verdict = verdict;
  deal.dispute.verdictReason = verdictReason.trim();
  deal.dispute.verdictBy = req.user._id;
  deal.dispute.verdictAt = new Date();
  deal.dispute.adminNotes = req.body.adminNotes;
  await deal.save();

  await logStatusChange(deal, prevStatus, newStatus, req.user, 'admin', `Admin verdict: ${verdict}. Reason: ${verdictReason.substring(0, 100)}`, req);

  await notificationService.notifyBoth({
    deal,
    type: 'dispute_resolved',
    buyerTitle: 'Dispute Resolved',
    buyerMessage: buyerMsg,
    sellerTitle: 'Dispute Resolved',
    sellerMessage: sellerMsg,
  });

  res.json({ success: true, message: `Dispute resolved. Verdict: ${verdict}`, data: { deal } });
};

// ─── GET DISPUTE DETAILS ──────────────────────────────────────────────────────
exports.getDisputeDetails = async (req, res) => {
  const deal = await Deal.findById(req.params.dealId)
    .populate('buyer', 'fullName email avatar phone')
    .populate('seller', 'fullName email avatar phone')
    .populate('dispute.raisedBy', 'fullName')
    .populate('dispute.verdictBy', 'fullName');

  if (!deal) throw new AppError('Deal not found.', 404);
  if (deal.status !== 'DISPUTED' && !deal.dispute?.verdict) throw new AppError('No dispute found for this deal.', 404);

  const isParty = deal.buyer._id.equals(req.user._id) || deal.seller._id.equals(req.user._id) || req.user.role === 'admin';
  if (!isParty) throw new AppError('Access denied.', 403);

  res.json({ success: true, data: { deal } });
};
