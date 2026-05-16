const Deal = require('../models/Deal');
const User = require('../models/User');
const { AuditLog, Notification } = require('../models/AuditLog');
const AppError = require('../utils/AppError');
const notificationService = require('../services/notification.service');
const emailService = require('../services/email.service');

const AUTO_APPROVAL_DAYS = parseInt(process.env.AUTO_APPROVAL_DAYS || '5');

// ─── HELPER: Log status change ─────────────────────────────────────────────────
async function logStatusChange(deal, fromStatus, toStatus, triggeredBy, role, action, req = {}) {
  await AuditLog.create({
    deal: deal._id,
    fromStatus,
    toStatus,
    triggeredBy: triggeredBy?._id || null,
    triggeredByRole: role,
    action,
    ipAddress: req.ip,
    userAgent: req.headers?.['user-agent'],
    timestamp: new Date(),
  });
}

// ─── CREATE DEAL ──────────────────────────────────────────────────────────────
exports.createDeal = async (req, res) => {
  const { title, description, category, amountPKR, deadline, sellerEmail, tags } = req.body;

  const normalizedSellerEmail = sellerEmail.toLowerCase().trim();
  if (normalizedSellerEmail === req.user.email) throw new AppError('You cannot create a deal with yourself.', 400);

  const amountInPaisa = Math.round(parseFloat(amountPKR) * 100);
  if (amountInPaisa < 100000) throw new AppError('Minimum deal amount is Rs. 1,000.', 400);

  // Seller may or may not be registered
  const seller = await User.findOne({ email: normalizedSellerEmail });
  if (seller && (!seller.isActive || seller.isSuspended)) throw new AppError('This seller account is not available.', 400);

  const dealData = {
    buyer: req.user._id,
    title: title.trim(),
    description: description.trim(),
    category: category || 'freelance',
    amountInPaisa,
    deadline: new Date(deadline),
    tags: tags || [],
    status: 'PENDING',
  };

  if (seller) {
    dealData.seller = seller._id;
  } else {
    dealData.sellerEmail = normalizedSellerEmail;
  }

  const deal = await Deal.create(dealData);
  await logStatusChange(deal, 'NEW', 'PENDING', req.user, 'buyer', 'Deal created by buyer', req);

  if (seller) {
    await notificationService.notify({
      recipient: seller._id,
      type: 'deal_created',
      title: 'New Deal Invitation',
      message: `${req.user.fullName} wants to escrow Rs. ${(amountInPaisa / 100).toLocaleString()} for "${title}". Review and accept or decline.`,
      deal: deal._id,
      emailData: { deal: await deal.populate(['buyer', 'seller']), seller },
      smsData: { phone: seller.phone, dealTitle: title, amount: amountInPaisa / 100, dealNumber: deal.dealNumber },
    });
  } else {
    // Seller not registered — send invite email
    const populatedForEmail = await Deal.findById(deal._id).populate('buyer', 'fullName email');
    await emailService.sendSellerInvite(normalizedSellerEmail, populatedForEmail, req.user);
  }

  const populated = await Deal.findById(deal._id).populate('buyer', 'fullName email avatar').populate('seller', 'fullName email avatar');
  res.status(201).json({ success: true, message: 'Deal created successfully.', data: { deal: populated } });
};

// ─── GET ALL DEALS (for current user) ────────────────────────────────────────
exports.getMyDeals = async (req, res) => {
  const { status, role, page = 1, limit = 10, search } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  let query = {};
  const userId = req.user._id;

  if (role === 'buyer') query.buyer = userId;
  else if (role === 'seller') query.seller = userId;
  else query.$or = [{ buyer: userId }, { seller: userId }];

  if (status) query.status = status.toUpperCase();
  if (search) query.$or = [
    { title: { $regex: search, $options: 'i' } },
    { dealNumber: { $regex: search, $options: 'i' } },
  ];

  const [deals, total] = await Promise.all([
    Deal.find(query)
      .populate('buyer', 'fullName email avatar stats')
      .populate('seller', 'fullName email avatar stats')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Deal.countDocuments(query),
  ]);

  res.json({
    success: true,
    data: { deals, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) },
  });
};

// ─── GET SINGLE DEAL ──────────────────────────────────────────────────────────
exports.getDeal = async (req, res) => {
  const [deal, auditLog] = await Promise.all([
    Deal.findById(req.params.id)
      .populate('buyer', 'fullName email avatar stats')
      .populate('seller', 'fullName email avatar stats')
      .populate('messages.sender', 'fullName avatar')
      .populate('dispute.raisedBy', 'fullName')
      .populate('dispute.verdictBy', 'fullName'),
    AuditLog.find({ deal: req.params.id })
      .populate('triggeredBy', 'fullName')
      .sort({ timestamp: 1 })
      .lean(),
  ]);

  if (!deal) throw new AppError('Deal not found.', 404);

  const buyerId = deal.buyer?._id;
  const sellerId = deal.seller?._id;
  const isParty = (buyerId && buyerId.equals(req.user._id)) ||
                  (sellerId && sellerId.equals(req.user._id)) ||
                  req.user.role === 'admin';
  if (!isParty) throw new AppError('Access denied.', 403);

  res.json({ success: true, data: { deal, auditLog } });
};

// ─── SELLER ACCEPTS DEAL ──────────────────────────────────────────────────────
exports.acceptDeal = async (req, res) => {
  const deal = await Deal.findById(req.params.id);
  if (!deal) throw new AppError('Deal not found.', 404);
  if (!deal.seller.equals(req.user._id)) throw new AppError('Only the seller can accept this deal.', 403);
  if (deal.status !== 'PENDING') throw new AppError(`Cannot accept a deal with status: ${deal.status}`, 400);

  // Seller must have bank details to receive payout
  const seller = await User.findById(req.user._id);
  if (!seller.bankDetails?.iban || !seller.bankDetails?.bankName || !seller.bankDetails?.accountTitle) {
    throw new AppError(
      'You must add your bank details before accepting deals. Go to Profile → Bank Details to add your IBAN.',
      400
    );
  }

  deal.sellerAcceptedAt = new Date();
  await deal.save();
  await logStatusChange(deal, 'PENDING', 'PENDING', req.user, 'seller', 'Seller accepted the deal. Awaiting buyer payment.', req);

  const populated = await deal.populate(['buyer', 'seller']);
  await notificationService.notify({
    recipient: deal.buyer,
    type: 'deal_accepted',
    title: 'Deal Accepted — Please Fund',
    message: `${req.user.fullName} accepted your deal "${deal.title}". Please deposit Rs. ${(deal.amountInPaisa / 100).toLocaleString()} to begin work.`,
    deal: deal._id,
    smsData: { phone: populated.buyer.phone, amount: deal.amountInPaisa / 100, dealNumber: deal.dealNumber },
  });

  res.json({ success: true, message: 'Deal accepted. Buyer has been notified to fund.', data: { deal } });
};

// ─── SELLER DECLINES DEAL ─────────────────────────────────────────────────────
exports.declineDeal = async (req, res) => {
  const { reason } = req.body;
  const deal = await Deal.findById(req.params.id);
  if (!deal) throw new AppError('Deal not found.', 404);
  if (!deal.seller.equals(req.user._id)) throw new AppError('Only the seller can decline this deal.', 403);
  if (deal.status !== 'PENDING') throw new AppError(`Cannot decline a deal with status: ${deal.status}`, 400);

  deal.status = 'CANCELLED';
  deal.cancelledAt = new Date();
  deal.adminNotes = reason ? `Seller declined: ${reason}` : 'Seller declined';
  await deal.save();

  await logStatusChange(deal, 'PENDING', 'CANCELLED', req.user, 'seller', `Seller declined the deal. Reason: ${reason || 'Not provided'}`, req);

  await notificationService.notify({
    recipient: deal.buyer,
    type: 'deal_declined',
    title: 'Deal Declined',
    message: `${req.user.fullName} declined your deal "${deal.title}".${reason ? ' Reason: ' + reason : ''}`,
    deal: deal._id,
  });

  res.json({ success: true, message: 'Deal declined.', data: { deal } });
};

// ─── SUBMIT DELIVERABLES ──────────────────────────────────────────────────────
exports.submitDeliverables = async (req, res) => {
  const { note, links } = req.body;
  const deal = await Deal.findById(req.params.id);
  if (!deal) throw new AppError('Deal not found.', 404);
  if (!deal.seller.equals(req.user._id)) throw new AppError('Only the seller can submit deliverables.', 403);
  if (deal.status !== 'FUNDED') throw new AppError('Deal must be FUNDED before submitting deliverables.', 400);

  // Process uploaded files (added by upload middleware)
  const files = req.uploadedFiles || [];

  const prevStatus = deal.status;
  deal.status = 'DELIVERED';
  deal.deliveredAt = new Date();
  deal.autoApprovalDeadline = new Date(Date.now() + AUTO_APPROVAL_DAYS * 24 * 60 * 60 * 1000);
  deal.deliverables = {
    note: note?.trim(),
    files,
    links: Array.isArray(links) ? links : (links ? JSON.parse(links) : []),
    submittedAt: new Date(),
  };
  await deal.save();

  await logStatusChange(deal, prevStatus, 'DELIVERED', req.user, 'seller', 'Seller submitted deliverables. Auto-approval timer started.', req);

  const populated = await deal.populate('buyer');
  await notificationService.notify({
    recipient: deal.buyer,
    type: 'deal_delivered',
    title: 'Work Submitted — Please Review',
    message: `${req.user.fullName} submitted work for "${deal.title}". You have ${AUTO_APPROVAL_DAYS} days to review and approve or raise a dispute.`,
    deal: deal._id,
    smsData: { phone: populated.buyer.phone, dealNumber: deal.dealNumber, days: AUTO_APPROVAL_DAYS },
  });

  res.json({ success: true, message: 'Deliverables submitted successfully. Buyer has been notified.', data: { deal } });
};

// ─── BUYER APPROVES DEAL ──────────────────────────────────────────────────────
exports.approveDeal = async (req, res) => {
  const deal = await Deal.findById(req.params.id);
  if (!deal) throw new AppError('Deal not found.', 404);
  if (!deal.buyer.equals(req.user._id)) throw new AppError('Only the buyer can approve this deal.', 403);
  if (deal.status !== 'DELIVERED') throw new AppError('Deal must be in DELIVERED status to approve.', 400);

  const prevStatus = deal.status;
  deal.status = 'COMPLETED';
  deal.completedAt = new Date();
  await deal.save();

  await logStatusChange(deal, prevStatus, 'COMPLETED', req.user, 'buyer', 'Buyer approved the work. Funds released to seller.', req);

  // Update user stats
  await Promise.all([
    User.findByIdAndUpdate(deal.buyer, { $inc: { 'stats.totalDealsAsBuyer': 1, 'stats.totalAmountSpent': deal.amountInPaisa } }),
    User.findByIdAndUpdate(deal.seller, { $inc: { 'stats.totalDealsAsSeller': 1, 'stats.totalAmountEarned': deal.sellerPayoutInPaisa } }),
  ]);

  const populated = await deal.populate(['buyer', 'seller']);
  await notificationService.notifyBoth({
    deal: populated,
    type: 'deal_completed',
    buyerTitle: 'Deal Completed',
    buyerMessage: `You approved "${deal.title}". The seller has been notified and payout is being processed.`,
    sellerTitle: 'Payment Released!',
    sellerMessage: `Your payment of Rs. ${(deal.sellerPayoutInPaisa / 100).toLocaleString()} for "${deal.title}" has been released. Payout will be processed within 24 hours.`,
  });

  res.json({ success: true, message: 'Deal approved. Seller payout is being processed.', data: { deal: populated } });
};

// ─── SEND MESSAGE ─────────────────────────────────────────────────────────────
exports.sendMessage = async (req, res) => {
  const { content } = req.body;
  const deal = await Deal.findById(req.params.id);
  if (!deal) throw new AppError('Deal not found.', 404);

  const isParty = deal.buyer.equals(req.user._id) || deal.seller.equals(req.user._id) || req.user.role === 'admin';
  if (!isParty) throw new AppError('Access denied.', 403);

  if (['COMPLETED', 'REFUNDED', 'CANCELLED'].includes(deal.status)) {
    throw new AppError('Cannot send messages on a closed deal.', 400);
  }

  const message = {
    sender: req.user._id,
    content: content.trim(),
    attachments: req.uploadedFiles || [],
    sentAt: new Date(),
  };

  deal.messages.push(message);
  await deal.save();

  // Notify the other party
  const recipientId = deal.buyer.equals(req.user._id) ? deal.seller : deal.buyer;
  await notificationService.notify({
    recipient: recipientId,
    type: 'system',
    title: 'New Message',
    message: `${req.user.fullName} sent a message on deal "${deal.title}"`,
    deal: deal._id,
  });

  res.json({ success: true, message: 'Message sent.', data: { message: { ...message, sender: { _id: req.user._id, fullName: req.user.fullName, avatar: req.user.avatar } } } });
};

// ─── GET DASHBOARD STATS ──────────────────────────────────────────────────────
exports.getDashboardStats = async (req, res) => {
  const userId = req.user._id;

  const [buyerStats, sellerStats] = await Promise.all([
    Deal.aggregate([
      { $match: { buyer: userId } },
      { $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amountInPaisa' },
      }},
    ]),
    Deal.aggregate([
      { $match: { seller: userId } },
      { $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalPayout: { $sum: '$sellerPayoutInPaisa' },
      }},
    ]),
  ]);

  const recentDeals = await Deal.find({
    $or: [{ buyer: userId }, { seller: userId }],
  })
    .populate('buyer', 'fullName avatar')
    .populate('seller', 'fullName avatar')
    .sort({ updatedAt: -1 })
    .limit(5);

  const unreadNotifications = await require('../models/AuditLog').Notification
    ? 0
    : 0;

  res.json({
    success: true,
    data: {
      buyerStats,
      sellerStats,
      recentDeals,
      user: req.user.toSafeObject(),
    },
  });
};

// ─── CANCEL DEAL ──────────────────────────────────────────────────────────────
exports.cancelDeal = async (req, res) => {
  const { reason } = req.body;
  const deal = await Deal.findById(req.params.id);
  if (!deal) throw new AppError('Deal not found.', 404);

  const isBuyer = deal.buyer.equals(req.user._id);
  if (!isBuyer && req.user.role !== 'admin') throw new AppError('Only the buyer or admin can cancel a deal.', 403);
  if (!['PENDING'].includes(deal.status)) throw new AppError('Only PENDING deals can be cancelled.', 400);

  const prevStatus = deal.status;
  deal.status = 'CANCELLED';
  deal.cancelledAt = new Date();
  deal.adminNotes = `Cancelled by ${req.user.role}. Reason: ${reason || 'Not provided'}`;
  await deal.save();

  await logStatusChange(deal, prevStatus, 'CANCELLED', req.user, req.user.role, `Deal cancelled. Reason: ${reason || 'Not provided'}`, req);

  res.json({ success: true, message: 'Deal cancelled.', data: { deal } });
};
