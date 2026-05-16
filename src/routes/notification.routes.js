// notification.routes.js
const express = require('express');
const { protect } = require('../middleware/auth');
const { Notification } = require('../models/AuditLog');
const router = express.Router();
router.use(protect);

router.get('/', async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [notifications, total, unread] = await Promise.all([
    Notification.find({ recipient: req.user._id })
      .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
    Notification.countDocuments({ recipient: req.user._id }),
    Notification.countDocuments({ recipient: req.user._id, isRead: false }),
  ]);
  res.json({ success: true, data: { notifications, total, unread } });
});

router.patch('/mark-read', async (req, res) => {
  await Notification.updateMany(
    { recipient: req.user._id, isRead: false },
    { isRead: true, readAt: new Date() }
  );
  res.json({ success: true, message: 'All notifications marked as read.' });
});

router.patch('/:id/read', async (req, res) => {
  await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.user._id },
    { isRead: true, readAt: new Date() }
  );
  res.json({ success: true });
});

module.exports = router;
