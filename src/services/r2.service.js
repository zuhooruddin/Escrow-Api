const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const logger = require('../utils/logger');

// ─── R2 CLIENT (S3-compatible) ────────────────────────────────────────────────
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;

// ─── GET PRESIGNED UPLOAD URL ─────────────────────────────────────────────────
// Frontend uploads directly to R2 — backend never handles file bytes
exports.getPresignedUrl = async (originalFilename, contentType, folder = 'uploads') => {
  const ext = path.extname(originalFilename);
  const key = `${folder}/${uuidv4()}${ext}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
    Metadata: { originalName: originalFilename },
  });

  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 300 }); // 5 min
  const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;

  logger.info(`R2 presigned URL generated: ${key}`);
  return { uploadUrl, key, publicUrl };
};

// ─── GET SIGNED DOWNLOAD URL (private files) ──────────────────────────────────
exports.getSignedDownloadUrl = async (key, expiresInSeconds = 3600) => {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const url = await getSignedUrl(r2Client, command, { expiresIn: expiresInSeconds });
  return url;
};

// ─── DELETE FILE ──────────────────────────────────────────────────────────────
exports.deleteFile = async (key) => {
  try {
    await r2Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    logger.info(`R2 file deleted: ${key}`);
    return true;
  } catch (err) {
    logger.error(`R2 delete failed for ${key}: ${err.message}`);
    return false;
  }
};

// ─── GET FOLDER SIZE (for monitoring) ────────────────────────────────────────
exports.getFileMetadata = (key) => {
  return { key, url: `${process.env.R2_PUBLIC_URL}/${key}` };
};
