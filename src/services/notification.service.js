const { Notification } = require('../models/AuditLog');
const User = require('../models/User');
const emailService = require('./email.service');
const smsService = require('./sms.service');
const logger = require('../utils/logger');

// ─── CORE NOTIFY FUNCTION ─────────────────────────────────────────────────────
exports.notify = async ({ recipient, type, title, message, deal, emailData, smsData, skipEmail, skipSMS }) => {
  try {
    // 1. Create in-app notification
    const notification = await Notification.create({
      recipient,
      type,
      title,
      message,
      deal,
      channels: {
        inApp: { sent: true, sentAt: new Date() },
        email: { sent: false },
        sms: { sent: false },
      },
    });

    // 2. Get user preferences
    const user = await User.findById(recipient);
    if (!user) return;

    // 3. Send email
    if (!skipEmail && user.notificationPrefs?.emailEnabled !== false) {
      try {
        await dispatchEmail(type, user, emailData);
        notification.channels.email = { sent: true, sentAt: new Date() };
      } catch (err) {
        notification.channels.email = { sent: false, error: err.message };
        logger.error(`Email notification failed: ${err.message}`);
      }
    }

    // 4. Send SMS
    if (!skipSMS && user.notificationPrefs?.smsEnabled !== false && smsData?.phone) {
      try {
        await dispatchSMS(type, smsData);
        notification.channels.sms = { sent: true, sentAt: new Date() };
      } catch (err) {
        notification.channels.sms = { sent: false, error: err.message };
        logger.error(`SMS notification failed: ${err.message}`);
      }
    }

    await notification.save();
    return notification;
  } catch (err) {
    logger.error(`Notification error: ${err.message}`);
  }
};

// ─── NOTIFY BOTH PARTIES ──────────────────────────────────────────────────────
exports.notifyBoth = async ({ deal, type, buyerTitle, buyerMessage, sellerTitle, sellerMessage, sellerSms }) => {
  await Promise.all([
    exports.notify({
      recipient: deal.buyer._id || deal.buyer,
      type,
      title: buyerTitle,
      message: buyerMessage,
      deal: deal._id,
    }),
    exports.notify({
      recipient: deal.seller._id || deal.seller,
      type,
      title: sellerTitle,
      message: sellerMessage,
      deal: deal._id,
      smsData: sellerSms,
    }),
  ]);
};

// ─── NOTIFY ADMIN ─────────────────────────────────────────────────────────────
exports.notifyAdmin = async ({ type, title, message, deal }) => {
  const adminUser = await User.findOne({ role: 'admin' });
  if (!adminUser) return;
  await exports.notify({ recipient: adminUser._id, type, title, message, deal });
};

// ─── EMAIL DISPATCHER ─────────────────────────────────────────────────────────
async function dispatchEmail(type, user, data) {
  switch (type) {
    case 'deal_created':
      if (data?.deal && data?.seller) await emailService.sendDealCreated(user, data.deal);
      break;
    case 'deal_funded':
      if (data?.deal) await emailService.sendDealFunded(user, data.deal);
      break;
    case 'deal_delivered':
      if (data?.deal) await emailService.sendDeliverySubmitted(user, data.deal);
      break;
    case 'deal_completed':
      if (data?.deal) await emailService.sendDealCompleted(user, data.deal, data.isSeller);
      break;
    case 'dispute_opened':
      if (data?.deal) await emailService.sendDisputeOpened(user, data.deal, data.isBuyer);
      break;
    case 'dispute_resolved':
      if (data?.deal) await emailService.sendDisputeResolved(user, data.deal, data.verdict, data.verdictMessage);
      break;
    default:
      break;
  }
}

// ─── SMS DISPATCHER ───────────────────────────────────────────────────────────
async function dispatchSMS(type, smsData) {
  const { phone, amount, dealNumber, days, hoursLeft } = smsData;
  switch (type) {
    case 'deal_created':
      await smsService.sendDealInvitation(phone, '', amount, dealNumber);
      break;
    case 'deal_funded':
      await smsService.sendFundsSecured(phone, amount, dealNumber);
      break;
    case 'deal_delivered':
      await smsService.sendWorkDelivered(phone, dealNumber, days || 5);
      break;
    case 'deal_completed':
      await smsService.sendPaymentReleased(phone, amount, dealNumber);
      break;
    case 'dispute_opened':
      await smsService.sendDisputeAlert(phone, dealNumber);
      break;
    default:
      break;
  }
}
