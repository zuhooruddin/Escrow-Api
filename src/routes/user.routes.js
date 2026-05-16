const express = require('express');
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const router = express.Router();
router.use(protect);

// Update profile
router.patch('/profile', async (req, res) => {
  const { fullName, phone, bio, city, avatar, notificationPrefs } = req.body;
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { fullName, phone, bio, city, avatar, notificationPrefs },
    { new: true, runValidators: true }
  );
  res.json({ success: true, data: { user: user.toSafeObject() } });
});

// Update bank details
router.patch('/bank-details', async (req, res) => {
  const { bankName, accountTitle, accountNumber, iban, branchCode } = req.body;
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { 'bankDetails.bankName': bankName, 'bankDetails.accountTitle': accountTitle, 'bankDetails.accountNumber': accountNumber, 'bankDetails.iban': iban, 'bankDetails.branchCode': branchCode },
    { new: true }
  );
  res.json({ success: true, message: 'Bank details updated.', data: { user: user.toSafeObject() } });
});

// Update mobile wallets
router.patch('/mobile-wallets', async (req, res) => {
  const { jazzCashNumber, easyPaisaNumber } = req.body;
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { 'mobileWallets.jazzCashNumber': jazzCashNumber, 'mobileWallets.easyPaisaNumber': easyPaisaNumber },
    { new: true }
  );
  res.json({ success: true, message: 'Mobile wallets updated.', data: { user: user.toSafeObject() } });
});

// Submit KYC
router.post('/kyc', async (req, res) => {
  const { documentType, documentNumber, documentFrontUrl, documentBackUrl } = req.body;
  if (!documentNumber || !documentFrontUrl) throw new AppError('Document number and front image required.', 400);

  const user = await User.findByIdAndUpdate(
    req.user._id,
    {
      'kyc.status': 'submitted',
      'kyc.documentType': documentType || 'CNIC',
      'kyc.documentNumber': documentNumber,
      'kyc.documentFrontUrl': documentFrontUrl,
      'kyc.documentBackUrl': documentBackUrl,
    },
    { new: true }
  );
  res.json({ success: true, message: 'KYC documents submitted. Admin will review within 24 hours.', data: { user: user.toSafeObject() } });
});

// Search user by email (for deal creation)
router.get('/search', async (req, res) => {
  const { email } = req.query;
  if (!email) throw new AppError('Email required.', 400);

  const user = await User.findOne({ email: email.toLowerCase().trim() })
    .select('fullName email avatar stats kyc.status');

  if (!user) return res.json({ success: true, data: { user: null } });
  res.json({ success: true, data: { user } });
});

// Public profile
router.get('/:id/profile', async (req, res) => {
  const user = await User.findById(req.params.id)
    .select('fullName avatar bio city stats createdAt kyc.status');
  if (!user) throw new AppError('User not found.', 404);
  res.json({ success: true, data: { user } });
});

module.exports = router;
