// dispute.routes.js
const express = require('express');
const disputeController = require('../controllers/dispute.controller');
const { protect, adminOnly } = require('../middleware/auth');
const router = express.Router();
router.use(protect);
router.post('/:dealId/raise', disputeController.raiseDispute);
router.post('/:dealId/respond', disputeController.respondToDispute);
router.get('/:dealId', disputeController.getDisputeDetails);
router.post('/:dealId/resolve', adminOnly, disputeController.resolveDispute);
module.exports = router;
