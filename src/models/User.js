const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // ─── BASIC INFO ─────────────────────────────────────────────────────────
  fullName: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true }, // Pakistani format: 03XXXXXXXXX
  password: { type: String, required: true, minlength: 8, select: false },

  // ─── ROLE ───────────────────────────────────────────────────────────────
  role: { type: String, enum: ['buyer', 'seller', 'both', 'admin'], default: 'both' },

  // ─── KYC ────────────────────────────────────────────────────────────────
  kyc: {
    status: { type: String, enum: ['pending', 'submitted', 'approved', 'rejected'], default: 'pending' },
    documentType: { type: String, enum: ['CNIC', 'PASSPORT', 'EMIRATES_ID'], default: 'CNIC' },
    documentNumber: { type: String, trim: true },
    documentFrontUrl: { type: String },
    documentBackUrl: { type: String },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: { type: String },
  },

  // ─── BANK DETAILS ────────────────────────────────────────────────────────
  bankDetails: {
    bankName: { type: String, trim: true },
    accountTitle: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    iban: { type: String, trim: true },
    branchCode: { type: String, trim: true },
    isVerified: { type: Boolean, default: false },
  },

  // ─── MOBILE WALLETS ──────────────────────────────────────────────────────
  mobileWallets: {
    jazzCashNumber: { type: String, trim: true },
    easyPaisaNumber: { type: String, trim: true },
  },

  // ─── PROFILE ────────────────────────────────────────────────────────────
  avatar: { type: String },
  bio: { type: String, maxlength: 500 },
  city: { type: String, trim: true },
  country: { type: String, default: 'PK', enum: ['PK', 'AE', 'SA', 'UK'] },
  currency: { type: String, default: 'PKR', enum: ['PKR', 'AED', 'USD'] },

  // ─── ACCOUNT STATUS ──────────────────────────────────────────────────────
  isEmailVerified: { type: Boolean, default: false },
  isPhoneVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  isSuspended: { type: Boolean, default: false },
  suspensionReason: { type: String },

  // ─── STATS ──────────────────────────────────────────────────────────────
  stats: {
    totalDealsAsBuyer: { type: Number, default: 0 },
    totalDealsAsSeller: { type: Number, default: 0 },
    totalAmountSpent: { type: Number, default: 0 }, // in paisa
    totalAmountEarned: { type: Number, default: 0 }, // in paisa
    completionRate: { type: Number, default: 100 },
    disputeRate: { type: Number, default: 0 },
    avgRatingAsSeller: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
  },

  // ─── SECURITY ────────────────────────────────────────────────────────────
  refreshTokens: [{ type: String }],
  passwordResetToken: String,
  passwordResetExpiry: Date,
  emailVerificationToken: String,
  failedLoginAttempts: { type: Number, default: 0 },
  lockUntil: Date,
  lastLogin: Date,
  lastLoginIP: String,

  // ─── TWO-FACTOR AUTH (admin only) ────────────────────────────────────────
  twofa_enabled:     { type: Boolean, default: false, select: false },
  twofa_secret:      { type: String, select: false },
  twofa_temp_secret: { type: String, select: false },

  // ─── NOTIFICATIONS PREFERENCES ───────────────────────────────────────────
  notificationPrefs: {
    emailEnabled: { type: Boolean, default: true },
    smsEnabled: { type: Boolean, default: true },
    inAppEnabled: { type: Boolean, default: true },
  },

}, { timestamps: true });

// ─── INDEXES ─────────────────────────────────────────────────────────────────
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ 'kyc.status': 1 });

// ─── HASH PASSWORD BEFORE SAVE ───────────────────────────────────────────────
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// ─── COMPARE PASSWORD ────────────────────────────────────────────────────────
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// ─── IS ACCOUNT LOCKED ───────────────────────────────────────────────────────
userSchema.methods.isLocked = function () {
  return this.lockUntil && this.lockUntil > Date.now();
};

// ─── SAFE USER OBJECT (no sensitive fields) ───────────────────────────────────
userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshTokens;
  delete obj.passwordResetToken;
  delete obj.passwordResetExpiry;
  delete obj.emailVerificationToken;
  delete obj.failedLoginAttempts;
  delete obj.lockUntil;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
