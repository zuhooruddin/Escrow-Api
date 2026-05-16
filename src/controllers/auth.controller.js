const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const emailService = require('../services/email.service');
const smsService = require('../services/sms.service');

// ─── GENERATE TOKENS ─────────────────────────────────────────────────────────
const generateTokens = exports.generateTokens = (userId) => {
  const accessToken = jwt.sign({ id: userId }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
  });
  const refreshToken = jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',
  });
  return { accessToken, refreshToken };
};

// ─── REGISTER ────────────────────────────────────────────────────────────────
exports.register = async (req, res) => {
  const { fullName, email, phone, password, role } = req.body;

  const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
  if (existingUser) {
    if (existingUser.email === email) throw new AppError('Email already registered.', 400);
    if (existingUser.phone === phone) throw new AppError('Phone number already registered.', 400);
  }

  // Generate email verification token
  const emailVerificationToken = crypto.randomBytes(32).toString('hex');

  const user = await User.create({
    fullName,
    email,
    phone,
    password,
    role: role || 'both',
    emailVerificationToken,
  });

  // Send verification email
  try {
    await emailService.sendEmailVerification(user, emailVerificationToken);
  } catch (err) {
    // Don't fail registration if email fails
    console.error('Email verification send failed:', err.message);
  }

  const { accessToken, refreshToken } = generateTokens(String(user._id));
  await User.findByIdAndUpdate(user._id, { $push: { refreshTokens: refreshToken } });

  res.status(201).json({
    success: true,
    message: 'Account created successfully. Please verify your email.',
    data: {
      user: user.toSafeObject(),
      accessToken,
      refreshToken,
    },
  });
};

// ─── LOGIN ───────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const { password } = req.body;

  const user = await User.findOne({ email }).select('+password +refreshTokens +failedLoginAttempts +lockUntil');
  if (!user) throw new AppError('Invalid email or password.', 401);

  // Check account lock
  if (user.isLocked()) {
    const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
    throw new AppError(`Account locked. Try again in ${minutesLeft} minute(s).`, 423);
  }

  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    // Increment failed attempts
    const attempts = user.failedLoginAttempts + 1;
    const update = { failedLoginAttempts: attempts };
    if (attempts >= 5) {
      update.lockUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minute lock
      update.failedLoginAttempts = 0;
    }
    await User.findByIdAndUpdate(user._id, update);
    throw new AppError('Invalid email or password.', 401);
  }

  if (!user.isActive || user.isSuspended) {
    throw new AppError('Your account has been suspended. Contact support@rakhwalipk.com', 403);
  }

  // Reset failed attempts, update last login
  await User.findByIdAndUpdate(user._id, {
    failedLoginAttempts: 0,
    lockUntil: undefined,
    lastLogin: new Date(),
    lastLoginIP: req.ip,
  });

  const { accessToken, refreshToken } = generateTokens(String(user._id));

  // Keep max 5 refresh tokens (cleanup old devices)
  let tokens = user.refreshTokens || [];
  if (tokens.length >= 5) tokens = tokens.slice(-4);
  tokens.push(refreshToken);
  await User.findByIdAndUpdate(user._id, { refreshTokens: tokens });

  res.json({
    success: true,
    message: 'Login successful.',
    data: {
      user: user.toSafeObject(),
      accessToken,
      refreshToken,
    },
  });
};

// ─── REFRESH TOKEN ────────────────────────────────────────────────────────────
exports.refreshToken = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new AppError('Refresh token required.', 401);

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    throw new AppError('Invalid or expired refresh token.', 401);
  }

  const user = await User.findById(String(decoded.id)).select('+refreshTokens');
  if (!user || !user.refreshTokens.includes(refreshToken)) {
    throw new AppError('Refresh token revoked. Please log in again.', 401);
  }

  // Rotate refresh token
  const { accessToken, refreshToken: newRefreshToken } = generateTokens(String(user._id));
  const tokens = user.refreshTokens.filter(t => t !== refreshToken);
  tokens.push(newRefreshToken);
  await User.findByIdAndUpdate(user._id, { refreshTokens: tokens });

  res.json({
    success: true,
    data: { accessToken, refreshToken: newRefreshToken },
  });
};

// ─── LOGOUT ──────────────────────────────────────────────────────────────────
exports.logout = async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { refreshTokens: refreshToken },
    });
  }
  res.json({ success: true, message: 'Logged out successfully.' });
};

// ─── GET CURRENT USER ─────────────────────────────────────────────────────────
exports.getMe = async (req, res) => {
  const user = await User.findById(req.user._id);
  res.json({ success: true, data: { user: user.toSafeObject() } });
};

// ─── FORGOT PASSWORD ──────────────────────────────────────────────────────────
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  // Always return success (security: don't reveal if email exists)
  if (user) {
    const resetToken = crypto.randomBytes(32).toString('hex');
    await User.findByIdAndUpdate(user._id, {
      passwordResetToken: crypto.createHash('sha256').update(resetToken).digest('hex'),
      passwordResetExpiry: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    });
    try {
      await emailService.sendPasswordReset(user, resetToken);
    } catch (err) {
      await User.findByIdAndUpdate(user._id, {
        passwordResetToken: undefined,
        passwordResetExpiry: undefined,
      });
    }
  }

  res.json({ success: true, message: 'If this email exists, a password reset link has been sent.' });
};

// ─── RESET PASSWORD ───────────────────────────────────────────────────────────
exports.resetPassword = async (req, res) => {
  const { token, password } = req.body;
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpiry: { $gt: Date.now() },
  });

  if (!user) throw new AppError('Password reset token is invalid or has expired.', 400);

  user.password = password;
  user.passwordResetToken = undefined;
  user.passwordResetExpiry = undefined;
  user.refreshTokens = []; // Invalidate all sessions
  await user.save();

  res.json({ success: true, message: 'Password reset successfully. Please log in.' });
};

// ─── VERIFY EMAIL ─────────────────────────────────────────────────────────────
exports.verifyEmail = async (req, res) => {
  const { token } = req.params;
  const user = await User.findOne({ emailVerificationToken: token });
  if (!user) throw new AppError('Invalid verification token.', 400);

  await User.findByIdAndUpdate(user._id, {
    isEmailVerified: true,
    emailVerificationToken: undefined,
  });

  res.json({ success: true, message: 'Email verified successfully.' });
};

// ─── CHANGE PASSWORD ──────────────────────────────────────────────────────────
exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password');

  const isValid = await user.comparePassword(currentPassword);
  if (!isValid) throw new AppError('Current password is incorrect.', 401);

  user.password = newPassword;
  user.refreshTokens = []; // Force re-login on all devices
  await user.save();

  res.json({ success: true, message: 'Password changed successfully. Please log in again.' });
};
