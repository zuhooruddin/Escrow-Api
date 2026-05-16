const crypto = require('crypto');
const Deal = require('../models/Deal');
const { AuditLog } = require('../models/AuditLog');
const AppError = require('../utils/AppError');
const notificationService = require('../services/notification.service');
const jazzCashService = require('../services/jazzcash.service');
const easypaisaService = require('../services/easypaisa.service');
const logger = require('../utils/logger');

const AUTO_APPROVAL_DAYS = parseInt(process.env.AUTO_APPROVAL_DAYS || '5');

async function logStatusChange(deal, fromStatus, toStatus, triggeredBy, role, action) {
  await AuditLog.create({
    deal: deal._id,
    fromStatus,
    toStatus,
    triggeredBy: triggeredBy?._id || null,
    triggeredByRole: role,
    action,
    timestamp: new Date(),
  });
}

// ─── INITIATE JAZZCASH PAYMENT ────────────────────────────────────────────────
exports.initiateJazzCash = async (req, res) => {
  const deal = await Deal.findById(req.params.dealId).populate('buyer seller');
  if (!deal) throw new AppError('Deal not found.', 404);
  if (!deal.buyer._id.equals(req.user._id)) throw new AppError('Only the buyer can make this payment.', 403);
  if (deal.status !== 'PENDING' || !deal.sellerAcceptedAt) {
    throw new AppError('Seller must accept the deal before payment can be made.', 400);
  }

  const amountPKR = (deal.amountInPaisa / 100).toFixed(2);
  const txnRef = `EPK-${deal.dealNumber}-${Date.now()}`;

  const paymentData = jazzCashService.generatePaymentRequest({
    amount: amountPKR,
    txnRef,
    description: `Escrow payment for deal ${deal.dealNumber}: ${deal.title}`,
    mobileNumber: req.user.phone,
    dealId: deal._id.toString(),
  });

  // Record payment attempt
  deal.payment = { method: 'jazzcash', transactionId: txnRef };
  await deal.save();

  res.json({
    success: true,
    message: 'JazzCash payment request generated.',
    data: { paymentData, txnRef, amountPKR },
  });
};

// ─── JAZZCASH WEBHOOK / CALLBACK ──────────────────────────────────────────────
exports.jazzCashCallback = async (req, res) => {
  try {
    const payload = req.body;
    logger.info('JazzCash callback received:', payload);

    // Verify HMAC signature
    const isValid = jazzCashService.verifyWebhook(payload);
    if (!isValid) {
      logger.warn('JazzCash webhook signature mismatch!', payload);
      return res.status(200).send('OK'); // Always 200 to JazzCash
    }

    const { pp_TxnRefNo, pp_ResponseCode, pp_Amount, pp_MerchantID } = payload;

    // Find deal by transaction reference
    const deal = await Deal.findOne({ 'payment.transactionId': pp_TxnRefNo });
    if (!deal) {
      logger.warn(`Deal not found for txnRef: ${pp_TxnRefNo}`);
      return res.status(200).send('OK');
    }

    if (deal.status !== 'PENDING') {
      return res.status(200).send('OK'); // Already processed
    }

    if (pp_ResponseCode === '000') {
      // Verify amount matches (in paisa)
      const paidAmountPaisa = Math.round(parseFloat(pp_Amount) * 100);
      if (paidAmountPaisa < deal.amountInPaisa) {
        logger.error(`Amount mismatch! Expected ${deal.amountInPaisa}, got ${paidAmountPaisa}`);
        return res.status(200).send('OK');
      }

      // SUCCESS — Fund the deal
      const prevStatus = deal.status;
      deal.status = 'FUNDED';
      deal.fundedAt = new Date();
      deal.payment.gatewayReference = pp_TxnRefNo;
      deal.payment.paidAt = new Date();
      await deal.save();

      await logStatusChange(deal, prevStatus, 'FUNDED', null, 'system', `JazzCash payment confirmed. TxnRef: ${pp_TxnRefNo}. Amount: Rs. ${deal.amountInPaisa / 100}`);

      const populated = await deal.populate(['buyer', 'seller']);
      await notificationService.notifyBoth({
        deal: populated,
        type: 'deal_funded',
        buyerTitle: 'Payment Successful',
        buyerMessage: `Your escrow payment of Rs. ${(deal.amountInPaisa / 100).toLocaleString()} for "${deal.title}" is confirmed.`,
        sellerTitle: 'Funds Secured — Begin Work!',
        sellerMessage: `Rs. ${(deal.amountInPaisa / 100).toLocaleString()} is locked in escrow for "${deal.title}". You can now start working.`,
        sellerSms: { phone: populated.seller.phone, amount: deal.amountInPaisa / 100, dealNumber: deal.dealNumber },
      });

    } else {
      logger.warn(`JazzCash payment failed. Code: ${pp_ResponseCode}, TxnRef: ${pp_TxnRefNo}`);
    }

    return res.status(200).send('OK');
  } catch (err) {
    logger.error('JazzCash callback error:', err);
    return res.status(200).send('OK'); // Always 200
  }
};

// ─── INITIATE EASYPAISA PAYMENT ───────────────────────────────────────────────
exports.initiateEasyPaisa = async (req, res) => {
  const deal = await Deal.findById(req.params.dealId).populate('buyer seller');
  if (!deal) throw new AppError('Deal not found.', 404);
  if (!deal.buyer._id.equals(req.user._id)) throw new AppError('Only the buyer can make this payment.', 403);
  if (deal.status !== 'PENDING' || !deal.sellerAcceptedAt) {
    throw new AppError('Seller must accept the deal before payment can be made.', 400);
  }

  const txnRef = `EPK-EP-${deal.dealNumber}-${Date.now()}`;
  const paymentData = easypaisaService.generatePaymentRequest({
    amount: (deal.amountInPaisa / 100).toFixed(2),
    txnRef,
    mobileNumber: req.user.phone,
    dealId: deal._id.toString(),
  });

  deal.payment = { method: 'easypaisa', transactionId: txnRef };
  await deal.save();

  res.json({ success: true, message: 'EasyPaisa payment request generated.', data: { paymentData, txnRef } });
};

// ─── EASYPAISA CALLBACK ───────────────────────────────────────────────────────
exports.easypaisaCallback = async (req, res) => {
  try {
    const payload = req.body;
    logger.info('EasyPaisa callback received:', payload);

    const isValid = easypaisaService.verifyWebhook(payload);
    if (!isValid) return res.status(200).json({ status: 'OK' });

    const { orderRefNum, transactionStatus, amount } = payload;
    const deal = await Deal.findOne({ 'payment.transactionId': orderRefNum });

    if (!deal || deal.status !== 'PENDING') return res.status(200).json({ status: 'OK' });

    if (transactionStatus === 'PAID') {
      const paidAmountPaisa = Math.round(parseFloat(amount) * 100);
      if (paidAmountPaisa < deal.amountInPaisa) return res.status(200).json({ status: 'OK' });

      const prevStatus = deal.status;
      deal.status = 'FUNDED';
      deal.fundedAt = new Date();
      deal.payment.paidAt = new Date();
      await deal.save();

      await logStatusChange(deal, prevStatus, 'FUNDED', null, 'system', `EasyPaisa payment confirmed. Ref: ${orderRefNum}`);

      const populated = await deal.populate(['buyer', 'seller']);
      await notificationService.notifyBoth({
        deal: populated,
        type: 'deal_funded',
        buyerTitle: 'EasyPaisa Payment Successful',
        buyerMessage: `Payment of Rs. ${(deal.amountInPaisa / 100).toLocaleString()} confirmed for "${deal.title}".`,
        sellerTitle: 'Funds Secured — Begin Work!',
        sellerMessage: `Rs. ${(deal.amountInPaisa / 100).toLocaleString()} is locked in escrow for "${deal.title}".`,
      });
    }

    return res.status(200).json({ status: 'OK' });
  } catch (err) {
    logger.error('EasyPaisa callback error:', err);
    return res.status(200).json({ status: 'OK' });
  }
};

// ─── SUBMIT IBFT BANK TRANSFER ────────────────────────────────────────────────
exports.submitIBFT = async (req, res) => {
  const deal = await Deal.findById(req.params.dealId);
  if (!deal) throw new AppError('Deal not found.', 404);
  if (!deal.buyer.equals(req.user._id)) throw new AppError('Only the buyer can submit payment.', 403);
  if (deal.status !== 'PENDING' || !deal.sellerAcceptedAt) {
    throw new AppError('Seller must accept the deal before payment can be submitted.', 400);
  }

  const screenshotUrl = req.uploadedFiles?.[0]?.r2Url;
  if (!screenshotUrl) throw new AppError('Payment screenshot is required for bank transfer verification.', 400);

  deal.payment = {
    method: 'bank_transfer',
    transactionId: `IBFT-${deal.dealNumber}-${Date.now()}`,
    ibftScreenshotUrl: screenshotUrl,
    paidAt: new Date(),
  };
  await deal.save();

  await logStatusChange(deal, deal.status, deal.status, req.user, 'buyer', 'Buyer submitted IBFT payment screenshot. Awaiting admin verification.', req);

  // Notify admin
  await notificationService.notifyAdmin({
    type: 'system',
    title: 'IBFT Payment Verification Required',
    message: `Deal ${deal.dealNumber} — Buyer submitted bank transfer screenshot. Amount: Rs. ${(deal.amountInPaisa / 100).toLocaleString()}. Please verify.`,
    deal: deal._id,
  });

  res.json({
    success: true,
    message: 'Bank transfer screenshot submitted. Admin will verify within 24 hours.',
    data: { deal },
  });
};

// ─── ADMIN CONFIRM IBFT ───────────────────────────────────────────────────────
exports.adminConfirmIBFT = async (req, res) => {
  if (req.user.role !== 'admin') throw new AppError('Admin access required.', 403);

  const deal = await Deal.findById(req.params.dealId);
  if (!deal) throw new AppError('Deal not found.', 404);
  if (deal.status !== 'PENDING') throw new AppError('Deal is not in PENDING status.', 400);
  if (deal.payment?.method !== 'bank_transfer') throw new AppError('This is not a bank transfer deal.', 400);

  const prevStatus = deal.status;
  deal.status = 'FUNDED';
  deal.fundedAt = new Date();
  deal.payment.ibftConfirmedBy = req.user._id;
  deal.payment.ibftConfirmedAt = new Date();
  await deal.save();

  await logStatusChange(deal, prevStatus, 'FUNDED', req.user, 'admin', `Admin confirmed IBFT payment. Verified by: ${req.user.fullName}`);

  const populated = await deal.populate(['buyer', 'seller']);
  await notificationService.notifyBoth({
    deal: populated,
    type: 'deal_funded',
    buyerTitle: 'Payment Verified',
    buyerMessage: `Your bank transfer for "${deal.title}" has been verified. Work can now begin.`,
    sellerTitle: 'Funds Confirmed — Begin Work!',
    sellerMessage: `Payment for "${deal.title}" has been verified. Rs. ${(deal.amountInPaisa / 100).toLocaleString()} is in escrow.`,
  });

  res.json({ success: true, message: 'IBFT payment confirmed. Deal funded.', data: { deal: populated } });
};

// ─── GET PLATFORM BANK DETAILS ────────────────────────────────────────────────
exports.getPlatformBankDetails = async (req, res) => {
  res.json({
    success: true,
    data: {
      bankName: process.env.PLATFORM_BANK_NAME || 'Meezan Bank',
      accountTitle: process.env.PLATFORM_ACCOUNT_TITLE || 'Rakhwali PK Pvt Ltd',
      accountNumber: process.env.PLATFORM_ACCOUNT_NUMBER || 'XXXX-XXXXXXXX-X',
      iban: process.env.PLATFORM_IBAN || 'PKXX MEZN XXXX XXXX XXXX XXXX',
      branchCode: process.env.PLATFORM_BRANCH_CODE || '0001',
      instructions: 'Please transfer the exact amount and include your deal number in the transfer description. Upload the screenshot after transfer.',
    },
  });
};
