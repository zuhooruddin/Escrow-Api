const cron = require('node-cron');
const Deal = require('../models/Deal');
const User = require('../models/User');
const { AuditLog } = require('../models/AuditLog');
const notificationService = require('../services/notification.service');
const smsService = require('../services/sms.service');
const logger = require('../utils/logger');

const AUTO_APPROVAL_DAYS = parseInt(process.env.AUTO_APPROVAL_DAYS || '5');

// ─── AUTO-APPROVAL JOB (every hour) ──────────────────────────────────────────
async function runAutoApproval() {
  logger.info('[CRON] Auto-approval check running...');
  try {
    const now = new Date();
    const expiredDeals = await Deal.find({
      status: 'DELIVERED',
      autoApprovalDeadline: { $lte: now },
    }).populate('buyer seller');

    for (const deal of expiredDeals) {
      logger.info(`[CRON] Auto-approving deal: ${deal.dealNumber}`);

      deal.status = 'COMPLETED';
      deal.completedAt = now;
      deal.isAutoApproved = true;
      await deal.save();

      await AuditLog.create({
        deal: deal._id,
        fromStatus: 'DELIVERED',
        toStatus: 'COMPLETED',
        triggeredBy: null,
        triggeredByRole: 'system',
        action: `Auto-approved by system. Buyer did not respond within ${AUTO_APPROVAL_DAYS} days.`,
        timestamp: now,
      });

      await User.findByIdAndUpdate(deal.buyer._id, {
        $inc: { 'stats.totalDealsAsBuyer': 1, 'stats.totalAmountSpent': deal.amountInPaisa }
      });
      await User.findByIdAndUpdate(deal.seller._id, {
        $inc: { 'stats.totalDealsAsSeller': 1, 'stats.totalAmountEarned': deal.sellerPayoutInPaisa }
      });

      await notificationService.notifyBoth({
        deal,
        type: 'deal_auto_approved',
        buyerTitle: 'Deal Auto-Approved',
        buyerMessage: `Deal "${deal.title}" was automatically approved as you did not respond within ${AUTO_APPROVAL_DAYS} days. Payment has been released to the seller.`,
        sellerTitle: '💰 Payment Auto-Released!',
        sellerMessage: `Deal "${deal.title}" was automatically approved. Rs. ${(deal.sellerPayoutInPaisa / 100).toLocaleString()} will be processed within 24 hours.`,
        sellerSms: { phone: deal.seller.phone, amount: deal.sellerPayoutInPaisa / 100, dealNumber: deal.dealNumber },
      });

      // SMS buyer
      await smsService.sendAutoApproved(deal.buyer.phone, deal.dealNumber, deal.amountInPaisa / 100);
    }

    if (expiredDeals.length > 0) {
      logger.info(`[CRON] Auto-approved ${expiredDeals.length} deal(s)`);
    }
  } catch (err) {
    logger.error('[CRON] Auto-approval error:', err.message);
  }
}

// ─── REVIEW REMINDER JOB (twice daily — 9am and 6pm) ─────────────────────────
async function runReviewReminders() {
  logger.info('[CRON] Review reminder check running...');
  try {
    const now = new Date();
    const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Deals where auto-approval is within 24 hours
    const urgentDeals = await Deal.find({
      status: 'DELIVERED',
      autoApprovalDeadline: { $gte: now, $lte: oneDayFromNow },
    }).populate('buyer seller');

    for (const deal of urgentDeals) {
      const hoursLeft = Math.ceil((deal.autoApprovalDeadline - now) / (60 * 60 * 1000));

      await notificationService.notify({
        recipient: deal.buyer._id,
        type: 'review_reminder',
        title: '⏰ Urgent: Deal Auto-Approves Soon',
        message: `Deal "${deal.title}" will be auto-approved in ${hoursLeft} hours. Login to review and approve or raise a dispute.`,
        deal: deal._id,
        smsData: { phone: deal.buyer.phone, dealNumber: deal.dealNumber, hoursLeft },
      });

      await smsService.sendAutoApprovalWarning(deal.buyer.phone, deal.dealNumber, hoursLeft);
    }

    // 3-day reminder (midpoint)
    const threeDayReminder = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const midpointDeals = await Deal.find({
      status: 'DELIVERED',
      autoApprovalDeadline: {
        $gte: new Date(threeDayReminder.getTime() - 60 * 60 * 1000),
        $lte: threeDayReminder
      },
    }).populate('buyer seller');

    for (const deal of midpointDeals) {
      await notificationService.notify({
        recipient: deal.buyer._id,
        type: 'review_reminder',
        title: 'Reminder: Please Review Delivered Work',
        message: `The seller submitted work for "${deal.title}". You have 2 days remaining to review. After that, payment auto-releases.`,
        deal: deal._id,
        skipSMS: true, // Don't send SMS for midpoint reminder
      });
    }

    logger.info(`[CRON] Sent ${urgentDeals.length} urgent + ${midpointDeals.length} midpoint reminders`);
  } catch (err) {
    logger.error('[CRON] Review reminder error:', err.message);
  }
}

// ─── DEADLINE WARNING JOB (daily at 8am) ──────────────────────────────────────
async function runDeadlineWarnings() {
  logger.info('[CRON] Deadline warning check running...');
  try {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dayAfter = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const nearDeadlineDeals = await Deal.find({
      status: 'FUNDED',
      deadline: { $gte: tomorrow, $lte: dayAfter },
    }).populate('buyer seller');

    for (const deal of nearDeadlineDeals) {
      await notificationService.notify({
        recipient: deal.seller._id,
        type: 'deadline_warning',
        title: '⚠ Deadline Tomorrow',
        message: `Your deal "${deal.title}" deadline is tomorrow. Please submit your deliverables on time.`,
        deal: deal._id,
        smsData: { phone: deal.seller.phone, dealNumber: deal.dealNumber },
      });
    }

    // Overdue deals (still FUNDED past deadline)
    const overdueDeals = await Deal.find({
      status: 'FUNDED',
      deadline: { $lt: new Date() },
    }).populate('buyer seller');

    for (const deal of overdueDeals) {
      await notificationService.notify({
        recipient: deal.buyer._id,
        type: 'deadline_warning',
        title: 'Deal Deadline Passed',
        message: `The deadline for "${deal.title}" has passed. The seller has not submitted work. You can raise a dispute.`,
        deal: deal._id,
        skipSMS: true,
      });
    }

    logger.info(`[CRON] Sent ${nearDeadlineDeals.length} deadline warnings, ${overdueDeals.length} overdue alerts`);
  } catch (err) {
    logger.error('[CRON] Deadline warning error:', err.message);
  }
}

// ─── DISPUTE RESPONSE REMINDER (daily at 10am) ────────────────────────────────
async function runDisputeReminders() {
  logger.info('[CRON] Dispute reminder check running...');
  try {
    const RESPONSE_DAYS = parseInt(process.env.DISPUTE_RESPONSE_DAYS || '3');
    const cutoff = new Date(Date.now() - RESPONSE_DAYS * 24 * 60 * 60 * 1000);

    const unansweredDisputes = await Deal.find({
      status: 'DISPUTED',
      disputedAt: { $lte: cutoff },
      'dispute.sellerResponse': { $exists: false },
    }).populate('buyer seller');

    for (const deal of unansweredDisputes) {
      await notificationService.notify({
        recipient: deal.seller._id,
        type: 'dispute_response',
        title: '⚠ Dispute Response Overdue',
        message: `You haven't responded to the dispute on "${deal.title}". Admin may rule in buyer's favor without your response.`,
        deal: deal._id,
        smsData: { phone: deal.seller.phone, dealNumber: deal.dealNumber },
      });
      await smsService.sendDisputeAlert(deal.seller.phone, deal.dealNumber);
    }

    logger.info(`[CRON] Sent ${unansweredDisputes.length} dispute response reminders`);
  } catch (err) {
    logger.error('[CRON] Dispute reminder error:', err.message);
  }
}

// ─── START ALL CRON JOBS ──────────────────────────────────────────────────────
exports.startCronJobs = () => {
  // Auto-approval: every hour at minute 0
  cron.schedule('0 * * * *', runAutoApproval, { timezone: 'Asia/Karachi' });

  // Review reminders: 9am and 6pm daily
  cron.schedule('0 9,18 * * *', runReviewReminders, { timezone: 'Asia/Karachi' });

  // Deadline warnings: 8am daily
  cron.schedule('0 8 * * *', runDeadlineWarnings, { timezone: 'Asia/Karachi' });

  // Dispute reminders: 10am daily
  cron.schedule('0 10 * * *', runDisputeReminders, { timezone: 'Asia/Karachi' });

  logger.info('[CRON] All jobs scheduled (timezone: Asia/Karachi)');

  // Run auto-approval immediately on startup (catch any missed while server was down)
  runAutoApproval();
};

// Export for manual testing
exports.runAutoApproval = runAutoApproval;
exports.runReviewReminders = runReviewReminders;
exports.runDeadlineWarnings = runDeadlineWarnings;
exports.runDisputeReminders = runDisputeReminders;
