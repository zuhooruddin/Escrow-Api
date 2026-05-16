const express = require('express');
const paymentController = require('../controllers/payment.controller');
const { protect, adminOnly } = require('../middleware/auth');
const router = express.Router();

// Public webhooks (no auth — verified by HMAC)
router.post('/jazzcash/callback', paymentController.jazzCashCallback);
router.post('/easypaisa/callback', paymentController.easypaisaCallback);

// Protected
router.use(protect);
router.get('/bank-details', paymentController.getPlatformBankDetails);
router.post('/:dealId/jazzcash', paymentController.initiateJazzCash);
router.post('/:dealId/easypaisa', paymentController.initiateEasyPaisa);
router.post('/:dealId/ibft', paymentController.submitIBFT);
router.patch('/:dealId/ibft/confirm', adminOnly, paymentController.adminConfirmIBFT);

module.exports = router;
