// upload.routes.js
const express = require('express');
const { protect } = require('../middleware/auth');
const r2Service = require('../services/r2.service');
const AppError = require('../utils/AppError');
const router = express.Router();
router.use(protect);

// Get presigned URL for direct upload from frontend
router.post('/presign', async (req, res) => {
  const { filename, contentType, folder } = req.body;
  if (!filename || !contentType) throw new AppError('filename and contentType required.', 400);

  const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'pdf,doc,docx,png,jpg,jpeg,gif,mp4,zip').split(',');
  const ext = filename.split('.').pop().toLowerCase();
  if (!allowedTypes.includes(ext)) throw new AppError(`File type .${ext} not allowed.`, 400);

  const { uploadUrl, key, publicUrl } = await r2Service.getPresignedUrl(filename, contentType, folder || 'deliverables');
  res.json({ success: true, data: { uploadUrl, key, publicUrl } });
});

// Get secure download URL for a private file
router.post('/signed-url', async (req, res) => {
  const { key } = req.body;
  if (!key) throw new AppError('File key required.', 400);
  const url = await r2Service.getSignedDownloadUrl(key);
  res.json({ success: true, data: { url } });
});

module.exports = router;
