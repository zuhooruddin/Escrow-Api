// deal.routes.js
const express = require('express');
const dealController = require('../controllers/deal.controller');
const { protect } = require('../middleware/auth');
const { generateReceiptPDF } = require('../services/receipt.service');
const Deal = require('../models/Deal');
const AppError = require('../utils/AppError');
const router = express.Router();
router.use(protect);
router.get('/my', dealController.getMyDeals);
router.get('/dashboard', dealController.getDashboardStats);
router.get('/:id', dealController.getDeal);
router.post('/', dealController.createDeal);
router.patch('/:id/accept', dealController.acceptDeal);
router.patch('/:id/decline', dealController.declineDeal);
router.patch('/:id/deliver', dealController.submitDeliverables);
router.patch('/:id/approve', dealController.approveDeal);
router.patch('/:id/cancel', dealController.cancelDeal);
router.post('/:id/message', dealController.sendMessage);

// ── PDF RECEIPT DOWNLOAD ──────────────────────────────────────────────────────
router.get('/:id/receipt', async (req, res) => {
  const deal = await Deal.findById(req.params.id)
    .populate('buyer', 'fullName email')
    .populate('seller', 'fullName email');
  if (!deal) throw new AppError('Deal not found.', 404);

  const isParty = deal.buyer._id.equals(req.user._id) || deal.seller._id.equals(req.user._id) || req.user.role === 'admin';
  if (!isParty) throw new AppError('Access denied.', 403);
  if (deal.status !== 'COMPLETED') throw new AppError('Receipt is only available for completed deals.', 400);

  const pdfBuffer = await generateReceiptPDF(deal);

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="receipt-${deal.dealNumber}.pdf"`,
    'Content-Length': pdfBuffer.length,
  });
  res.send(pdfBuffer);
});

module.exports = router;
