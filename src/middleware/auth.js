const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AppError = require('../utils/AppError');

// ─── PROTECT ROUTE ────────────────────────────────────────────────────────────
exports.protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError('Authentication required. Please log in.', 401);
  }

  const token = authHeader.split(' ')[1];
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Session expired. Please log in again.', 401);
    }
    throw new AppError('Invalid authentication token.', 401);
  }

  const user = await User.findById(String(decoded.id)).select('+refreshTokens');
  if (!user) throw new AppError('User no longer exists.', 401);
  if (!user.isActive || user.isSuspended) {
    throw new AppError('Your account has been suspended. Contact support.', 403);
  }

  req.user = user;
  next();
};

// ─── RESTRICT TO ROLES ────────────────────────────────────────────────────────
exports.restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    throw new AppError('You do not have permission to perform this action.', 403);
  }
  next();
};

// ─── ADMIN ONLY ───────────────────────────────────────────────────────────────
exports.adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    throw new AppError('Admin access required.', 403);
  }
  next();
};

// ─── REQUIRE KYC ─────────────────────────────────────────────────────────────
exports.requireKYC = (req, res, next) => {
  if (req.user.kyc.status !== 'approved') {
    throw new AppError('KYC verification required to perform this action. Please complete your identity verification.', 403);
  }
  next();
};
