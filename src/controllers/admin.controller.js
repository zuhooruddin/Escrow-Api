const Deal = require('../models/Deal');
const User = require('../models/User');
const { AuditLog, Notification } = require('../models/AuditLog');
const AppError = require('../utils/AppError');
const notificationService = require('../services/notification.service');

// ─── DASHBOARD STATS ──────────────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

  const [
    totalDeals, totalUsers, activeDisputes, pendingKYC,
    dealsThisMonth, revenueThisMonth, pendingIBFT,
    dealsByStatus, revenueByDay
  ] = await Promise.all([
    Deal.countDocuments(),
    User.countDocuments({ role: { $ne: 'admin' } }),
    Deal.countDocuments({ status: 'DISPUTED' }),
    User.countDocuments({ 'kyc.status': 'submitted' }),
    Deal.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    Deal.aggregate([
      { $match: { status: 'COMPLETED', completedAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: '$platformFeeInPaisa' } } },
    ]),
    Deal.countDocuments({ status: 'PENDING', 'payment.method': 'bank_transfer', 'payment.ibftScreenshotUrl': { $exists: true }, 'payment.ibftConfirmedBy': { $exists: false } }),
    Deal.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Deal.aggregate([
      { $match: { status: 'COMPLETED', completedAt: { $gte: sevenDaysAgo } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt' } },
        revenue: { $sum: '$platformFeeInPaisa' },
        deals: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]),
  ]);

  const totalRevenuePaisa = revenueThisMonth[0]?.total || 0;
  const totalHeldInEscrow = await Deal.aggregate([
    { $match: { status: { $in: ['FUNDED', 'DELIVERED', 'DISPUTED'] } } },
    { $group: { _id: null, total: { $sum: '$amountInPaisa' } } },
  ]);

  res.json({
    success: true,
    data: {
      overview: {
        totalDeals,
        totalUsers,
        activeDisputes,
        pendingKYC,
        dealsThisMonth,
        revenueThisMonthPKR: totalRevenuePaisa / 100,
        pendingIBFT,
        escrowHeldPKR: (totalHeldInEscrow[0]?.total || 0) / 100,
      },
      dealsByStatus,
      revenueByDay,
    },
  });
};

// ─── ALL DEALS ────────────────────────────────────────────────────────────────
exports.getAllDeals = async (req, res) => {
  const { status, page = 1, limit = 20, search, category, flagged, dateFrom, dateTo } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  let query = {};
  if (status) query.status = status.toUpperCase();
  if (category) query.category = category;
  if (flagged === 'true') query.flagged = true;
  if (dateFrom || dateTo) {
    query.createdAt = {};
    if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
    if (dateTo) query.createdAt.$lte = new Date(dateTo);
  }
  if (search) {
    query.$or = [
      { dealNumber: { $regex: search, $options: 'i' } },
      { title: { $regex: search, $options: 'i' } },
    ];
  }

  const [deals, total] = await Promise.all([
    Deal.find(query)
      .populate('buyer', 'fullName email')
      .populate('seller', 'fullName email')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Deal.countDocuments(query),
  ]);

  res.json({ success: true, data: { deals, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) } });
};

// ─── GET DEAL FULL DETAILS (admin) ────────────────────────────────────────────
exports.getDealDetails = async (req, res) => {
  const deal = await Deal.findById(req.params.id)
    .populate('buyer', 'fullName email phone avatar kyc bankDetails')
    .populate('seller', 'fullName email phone avatar kyc bankDetails')
    .populate('dispute.raisedBy', 'fullName')
    .populate('dispute.verdictBy', 'fullName');

  if (!deal) throw new AppError('Deal not found.', 404);

  const auditLog = await AuditLog.find({ deal: deal._id })
    .populate('triggeredBy', 'fullName email')
    .sort({ timestamp: 1 });

  res.json({ success: true, data: { deal, auditLog } });
};

// ─── DISPUTES QUEUE ───────────────────────────────────────────────────────────
exports.getDisputes = async (req, res) => {
  const { page = 1, limit = 20, verdict } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  let query = { status: 'DISPUTED' };
  if (verdict === 'pending') query['dispute.verdict'] = { $exists: false };
  if (verdict === 'resolved') query['dispute.verdict'] = { $exists: true };

  const [deals, total] = await Promise.all([
    Deal.find(query)
      .populate('buyer', 'fullName email avatar')
      .populate('seller', 'fullName email avatar')
      .populate('dispute.raisedBy', 'fullName')
      .sort({ disputedAt: 1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Deal.countDocuments(query),
  ]);

  res.json({ success: true, data: { deals, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) } });
};

// ─── KYC QUEUE ───────────────────────────────────────────────────────────────
exports.getKYCQueue = async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [users, total] = await Promise.all([
    User.find({ 'kyc.status': 'submitted' })
      .select('fullName email phone kyc createdAt')
      .sort({ 'kyc.submittedAt': 1 })
      .skip(skip)
      .limit(parseInt(limit)),
    User.countDocuments({ 'kyc.status': 'submitted' }),
  ]);

  res.json({ success: true, data: { users, total } });
};

// ─── APPROVE/REJECT KYC ───────────────────────────────────────────────────────
exports.reviewKYC = async (req, res) => {
  const { userId, action, rejectionReason } = req.body;
  if (!['approve', 'reject'].includes(action)) throw new AppError('Invalid action.', 400);

  const user = await User.findById(userId);
  if (!user) throw new AppError('User not found.', 404);

  user.kyc.status = action === 'approve' ? 'approved' : 'rejected';
  user.kyc.reviewedAt = new Date();
  user.kyc.reviewedBy = req.user._id;
  if (action === 'reject') user.kyc.rejectionReason = rejectionReason;
  await user.save();

  await notificationService.notify({
    recipient: user._id,
    type: action === 'approve' ? 'kyc_approved' : 'kyc_rejected',
    title: action === 'approve' ? 'KYC Approved' : 'KYC Rejected',
    message: action === 'approve'
      ? 'Your identity has been verified. You can now create and fund deals.'
      : `Your KYC was rejected. Reason: ${rejectionReason}. Please resubmit with correct documents.`,
  });

  res.json({ success: true, message: `KYC ${action}d successfully.` });
};

// ─── ALL USERS ────────────────────────────────────────────────────────────────
exports.getAllUsers = async (req, res) => {
  const { page = 1, limit = 20, search, role, status } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  let query = { role: { $ne: 'admin' } };
  if (role) query.role = role;
  if (status === 'suspended') query.isSuspended = true;
  if (status === 'active') query.isSuspended = false;
  if (search) {
    query.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
    User.countDocuments(query),
  ]);

  res.json({ success: true, data: { users, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) } });
};

// ─── SUSPEND / UNSUSPEND USER ─────────────────────────────────────────────────
exports.toggleSuspend = async (req, res) => {
  const { userId, reason } = req.body;
  const user = await User.findById(userId);
  if (!user) throw new AppError('User not found.', 404);
  if (user.role === 'admin') throw new AppError('Cannot suspend admin accounts.', 403);

  user.isSuspended = !user.isSuspended;
  if (user.isSuspended) user.suspensionReason = reason;
  else user.suspensionReason = undefined;
  await user.save();

  await notificationService.notify({
    recipient: user._id,
    type: 'account_suspended',
    title: user.isSuspended ? 'Account Suspended' : 'Account Reinstated',
    message: user.isSuspended
      ? `Your account has been suspended. Reason: ${reason}. Contact support@rakhwalipk.com`
      : 'Your account has been reinstated. You may now access all platform features.',
  });

  res.json({ success: true, message: `User ${user.isSuspended ? 'suspended' : 'reinstated'} successfully.` });
};

// ─── FLAG DEAL ────────────────────────────────────────────────────────────────
exports.flagDeal = async (req, res) => {
  const { dealId, reason } = req.body;
  const deal = await Deal.findByIdAndUpdate(dealId, { flagged: true, flagReason: reason }, { new: true });
  if (!deal) throw new AppError('Deal not found.', 404);
  res.json({ success: true, message: 'Deal flagged for review.', data: { deal } });
};

// ─── REVENUE REPORT ───────────────────────────────────────────────────────────
exports.getRevenueReport = async (req, res) => {
  const { from, to, groupBy = 'day' } = req.query;
  const dateFrom = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const dateTo = to ? new Date(to) : new Date();

  const formatStr = groupBy === 'month' ? '%Y-%m' : groupBy === 'week' ? '%Y-%U' : '%Y-%m-%d';

  const revenue = await Deal.aggregate([
    { $match: { status: 'COMPLETED', completedAt: { $gte: dateFrom, $lte: dateTo } } },
    { $group: {
      _id: { $dateToString: { format: formatStr, date: '$completedAt' } },
      totalRevenue: { $sum: '$platformFeeInPaisa' },
      totalDeals: { $sum: 1 },
      totalVolume: { $sum: '$amountInPaisa' },
    }},
    { $sort: { _id: 1 } },
  ]);

  const totals = await Deal.aggregate([
    { $match: { status: 'COMPLETED', completedAt: { $gte: dateFrom, $lte: dateTo } } },
    { $group: {
      _id: null,
      totalRevenue: { $sum: '$platformFeeInPaisa' },
      totalDeals: { $sum: 1 },
      totalVolume: { $sum: '$amountInPaisa' },
    }},
  ]);

  res.json({
    success: true,
    data: {
      report: revenue,
      totals: totals[0] || { totalRevenue: 0, totalDeals: 0, totalVolume: 0 },
      period: { from: dateFrom, to: dateTo },
    },
  });
};

// ─── MANUAL PAYOUT ────────────────────────────────────────────────────────────
exports.initiatePayout = async (req, res) => {
  const { dealId, referenceNumber, payoutMethod, notes } = req.body;
  const deal = await Deal.findById(dealId);
  if (!deal) throw new AppError('Deal not found.', 404);
  if (!['COMPLETED', 'REFUNDED'].includes(deal.status)) throw new AppError('Deal must be COMPLETED or REFUNDED for payout.', 400);
  if (deal.payout?.completedAt) throw new AppError('Payout already completed for this deal.', 400);

  deal.payout = {
    method: payoutMethod || 'bank_transfer',
    initiatedAt: new Date(),
    completedAt: new Date(),
    referenceNumber,
    initiatedBy: req.user._id,
  };
  if (notes) deal.adminNotes = notes;
  await deal.save();

  await AuditLog.create({
    deal: deal._id, fromStatus: deal.status, toStatus: deal.status,
    triggeredBy: req.user._id, triggeredByRole: 'admin',
    action: `Admin initiated payout. Method: ${payoutMethod}. Reference: ${referenceNumber}`,
  });

  res.json({ success: true, message: 'Payout recorded successfully.', data: { deal } });
};

// ─── PENDING IBFT LIST ────────────────────────────────────────────────────────
exports.getPendingIBFT = async (req, res) => {
  const deals = await Deal.find({
    status: 'PENDING',
    'payment.method': 'bank_transfer',
    'payment.ibftScreenshotUrl': { $exists: true, $ne: null },
    'payment.ibftConfirmedBy': { $exists: false },
  })
    .populate('buyer', 'fullName email phone')
    .populate('seller', 'fullName email')
    .sort({ 'payment.paidAt': 1 });

  res.json({ success: true, data: { deals } });
};
