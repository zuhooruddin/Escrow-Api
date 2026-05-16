const speakeasy = require('speakeasy');
const QRCode    = require('qrcode');
const User      = require('../models/User');
const AppError  = require('../utils/AppError');

// ─── SETUP 2FA — generates secret + QR code ───────────────────────────────────
exports.setup2FA = async (req, res) => {
  if (req.user.role !== 'admin') throw new AppError('Admin only.', 403);

  const secret = speakeasy.generateSecret({
    name: `Rakhwali PK Admin (${req.user.email})`,
    length: 32,
  });

  // Store temp secret (not confirmed yet)
  await User.findByIdAndUpdate(req.user._id, { twofa_temp_secret: secret.base32 });

  const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);

  res.json({
    success: true,
    data: {
      secret: secret.base32,
      qrCode: qrDataUrl,
      manualEntry: secret.base32,
    },
  });
};

// ─── VERIFY & ENABLE 2FA ─────────────────────────────────────────────────────
exports.enable2FA = async (req, res) => {
  if (req.user.role !== 'admin') throw new AppError('Admin only.', 403);
  const { token } = req.body;
  if (!token) throw new AppError('TOTP token required.', 400);

  const user = await User.findById(req.user._id).select('+twofa_temp_secret +twofa_secret +twofa_enabled');
  if (!user.twofa_temp_secret) throw new AppError('No pending 2FA setup. Call /setup first.', 400);

  const valid = speakeasy.totp.verify({
    secret: user.twofa_temp_secret,
    encoding: 'base32',
    token,
    window: 1,
  });
  if (!valid) throw new AppError('Invalid code. Check your authenticator app and try again.', 400);

  await User.findByIdAndUpdate(req.user._id, {
    twofa_secret: user.twofa_temp_secret,
    twofa_enabled: true,
    twofa_temp_secret: undefined,
  });

  res.json({ success: true, message: '2FA enabled successfully. Required for all future admin logins.' });
};

// ─── VERIFY 2FA TOKEN (called after password login) ──────────────────────────
exports.verify2FA = async (req, res) => {
  const { token, tempToken } = req.body;
  if (!token || !tempToken) throw new AppError('token and tempToken required.', 400);

  // Decode the tempToken to get userId
  const jwt = require('jsonwebtoken');
  let decoded;
  try {
    decoded = jwt.verify(tempToken, process.env.JWT_2FA_SECRET || process.env.JWT_ACCESS_SECRET);
  } catch {
    throw new AppError('Temporary token expired. Please log in again.', 401);
  }

  const user = await User.findById(decoded.id).select('+twofa_secret +twofa_enabled +refreshTokens');
  if (!user || !user.twofa_enabled) throw new AppError('2FA not enabled on this account.', 400);

  const valid = speakeasy.totp.verify({
    secret: user.twofa_secret,
    encoding: 'base32',
    token,
    window: 1,
  });
  if (!valid) throw new AppError('Invalid 2FA code.', 401);

  // Issue real access + refresh tokens
  const { generateTokens } = require('./auth.controller');
  const tokens = generateTokens(String(user._id));

  let refreshTokens = user.refreshTokens || [];
  if (refreshTokens.length >= 5) refreshTokens = refreshTokens.slice(-4);
  refreshTokens.push(tokens.refreshToken);
  await User.findByIdAndUpdate(user._id, { refreshTokens });

  res.json({
    success: true,
    message: '2FA verified.',
    data: { user: user.toSafeObject(), ...tokens },
  });
};

// ─── DISABLE 2FA ─────────────────────────────────────────────────────────────
exports.disable2FA = async (req, res) => {
  if (req.user.role !== 'admin') throw new AppError('Admin only.', 403);
  const { token } = req.body;

  const user = await User.findById(req.user._id).select('+twofa_secret +twofa_enabled');
  if (!user.twofa_enabled) throw new AppError('2FA is not enabled.', 400);

  const valid = speakeasy.totp.verify({
    secret: user.twofa_secret,
    encoding: 'base32',
    token,
    window: 1,
  });
  if (!valid) throw new AppError('Invalid 2FA code.', 400);

  await User.findByIdAndUpdate(req.user._id, {
    twofa_secret: undefined,
    twofa_enabled: false,
  });

  res.json({ success: true, message: '2FA disabled.' });
};
