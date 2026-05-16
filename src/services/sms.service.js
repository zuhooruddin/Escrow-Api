const axios = require('axios');
const logger = require('../utils/logger');

// ─── SEND SMS VIA ZONG API ────────────────────────────────────────────────────
async function sendSMS(phone, message) {
  try {
    // Normalize Pakistani phone number
    let normalized = phone.replace(/\s+/g, '').replace(/-/g, '');
    if (normalized.startsWith('0')) normalized = '92' + normalized.slice(1);
    if (!normalized.startsWith('92')) normalized = '92' + normalized;

    const response = await axios.post(process.env.ZONG_API_URL, {
      username: process.env.ZONG_USERNAME,
      password: process.env.ZONG_PASSWORD,
      to: normalized,
      from: process.env.ZONG_SENDER_ID || 'Rakhwali PK',
      message: message.substring(0, 160), // SMS limit
    }, { timeout: 10000 });

    logger.info(`SMS sent to ${normalized}: ${message.substring(0, 50)}...`);
    return { success: true, response: response.data };
  } catch (err) {
    logger.error(`SMS failed to ${phone}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ─── SMS TEMPLATES ────────────────────────────────────────────────────────────
exports.sendDealInvitation = async (phone, sellerName, amount, dealNumber) => {
  const msg = `Rakhwali PK: New deal invitation! Rs.${amount.toLocaleString()} waiting for you. Deal #${dealNumber}. Login to accept. rakhwalipk.com`;
  return sendSMS(phone, msg);
};

exports.sendFundsSecured = async (phone, amount, dealNumber) => {
  const msg = `Rakhwali PK: Funds confirmed! Rs.${amount.toLocaleString()} locked in escrow for deal #${dealNumber}. You can now start working. rakhwalipk.com`;
  return sendSMS(phone, msg);
};

exports.sendWorkDelivered = async (phone, dealNumber, days) => {
  const msg = `Rakhwali PK: Work submitted for deal #${dealNumber}. Review & approve within ${days} days or funds auto-release. rakhwalipk.com`;
  return sendSMS(phone, msg);
};

exports.sendPaymentReleased = async (phone, amount, dealNumber) => {
  const msg = `Rakhwali PK: Payment released! Rs.${amount.toLocaleString()} for deal #${dealNumber} will reach your account within 24hrs. rakhwalipk.com`;
  return sendSMS(phone, msg);
};

exports.sendDisputeAlert = async (phone, dealNumber) => {
  const msg = `Rakhwali PK URGENT: Dispute raised on deal #${dealNumber}. Funds frozen. Login immediately to respond. rakhwalipk.com`;
  return sendSMS(phone, msg);
};

exports.sendAutoApprovalWarning = async (phone, dealNumber, hoursLeft) => {
  const msg = `Rakhwali PK Reminder: Deal #${dealNumber} auto-approves in ${hoursLeft}hrs. Login now to review or raise dispute. rakhwalipk.com`;
  return sendSMS(phone, msg);
};

exports.sendAutoApproved = async (phone, dealNumber, amount) => {
  const msg = `Rakhwali PK: Deal #${dealNumber} auto-approved. Rs.${amount.toLocaleString()} released to seller. rakhwalipk.com`;
  return sendSMS(phone, msg);
};

exports.sendPayoutConfirmed = async (phone, amount, dealNumber) => {
  const msg = `Rakhwali PK: Payout confirmed! Rs.${amount.toLocaleString()} transferred to your account for deal #${dealNumber}. rakhwalipk.com`;
  return sendSMS(phone, msg);
};

exports.sendRaw = sendSMS;
