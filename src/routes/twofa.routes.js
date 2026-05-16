const express = require('express');
const { protect } = require('../middleware/auth');
const twofa = require('../controllers/twofa.controller');
const router = express.Router();

router.post('/setup',   protect, twofa.setup2FA);
router.post('/enable',  protect, twofa.enable2FA);
router.post('/verify',  twofa.verify2FA);   // called before full auth token is issued
router.post('/disable', protect, twofa.disable2FA);

module.exports = router;
