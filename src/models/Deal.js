const mongoose = require('mongoose');

// ─── DEAL STATUSES ────────────────────────────────────────────────────────────
const DEAL_STATUSES = ['PENDING', 'FUNDED', 'DELIVERED', 'COMPLETED', 'DISPUTED', 'REFUNDED', 'CANCELLED', 'EXPIRED'];

const dealSchema = new mongoose.Schema({
  // ─── DEAL REFERENCE ──────────────────────────────────────────────────────
  dealNumber: { type: String, unique: true }, // e.g. EPK-2024-00001

  // ─── PARTIES ─────────────────────────────────────────────────────────────
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  sellerEmail: { type: String, trim: true, lowercase: true }, // set when seller is not yet registered

  // ─── DEAL INFO ───────────────────────────────────────────────────────────
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, required: true, trim: true, maxlength: 5000 },
  category: {
    type: String,
    enum: ['freelance', 'domain_website', 'physical_goods', 'digital_products', 'other'],
    default: 'freelance'
  },
  tags: [{ type: String, trim: true }],

  // ─── FINANCIALS (stored in paisa — 1 PKR = 100 paisa) ───────────────────
  currency: { type: String, default: 'PKR', enum: ['PKR', 'AED', 'USD'] },
  amountInPaisa: { type: Number, required: true, min: 100000 }, // Min Rs. 1,000
  platformFeePercent: { type: Number, default: 2 },
  platformFeeInPaisa: { type: Number },
  sellerPayoutInPaisa: { type: Number },

  // ─── STATUS MACHINE ───────────────────────────────────────────────────────
  status: { type: String, enum: DEAL_STATUSES, default: 'PENDING' },

  // ─── TIMELINE ────────────────────────────────────────────────────────────
  deadline: { type: Date, required: true },
  sellerAcceptedAt: { type: Date },
  fundedAt: { type: Date },
  deliveredAt: { type: Date },
  completedAt: { type: Date },
  disputedAt: { type: Date },
  refundedAt: { type: Date },
  cancelledAt: { type: Date },
  autoApprovalDeadline: { type: Date }, // Set when status = DELIVERED

  // ─── PAYMENT INFO ────────────────────────────────────────────────────────
  payment: {
    method: { type: String, enum: ['jazzcash', 'easypaisa', 'bank_transfer'] },
    transactionId: { type: String },
    gatewayReference: { type: String },
    paidAt: { type: Date },
    receiptUrl: { type: String },
    ibftScreenshotUrl: { type: String }, // for manual bank transfer
    ibftConfirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ibftConfirmedAt: { type: Date },
  },

  // ─── PAYOUT INFO ─────────────────────────────────────────────────────────
  payout: {
    method: { type: String, enum: ['bank_transfer', 'raast', 'jazzcash', 'easypaisa'] },
    initiatedAt: { type: Date },
    completedAt: { type: Date },
    referenceNumber: { type: String },
    initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    receiptUrl: { type: String },
  },

  // ─── DELIVERABLES (submitted by seller) ──────────────────────────────────
  deliverables: {
    note: { type: String, trim: true, maxlength: 3000 },
    files: [{
      filename: String,
      originalName: String,
      r2Key: String,
      r2Url: String,
      fileSize: Number,
      mimeType: String,
      uploadedAt: { type: Date, default: Date.now },
    }],
    links: [{
      url: String,
      label: String,
      addedAt: { type: Date, default: Date.now },
    }],
    submittedAt: { type: Date },
  },

  // ─── MESSAGES / COMMUNICATION ────────────────────────────────────────────
  messages: [{
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, trim: true, maxlength: 2000, required: true },
    attachments: [{
      filename: String,
      r2Key: String,
      r2Url: String,
    }],
    sentAt: { type: Date, default: Date.now },
    isRead: { type: Boolean, default: false },
  }],

  // ─── DISPUTE ─────────────────────────────────────────────────────────────
  dispute: {
    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    buyerReason: { type: String, trim: true, maxlength: 3000 },
    buyerEvidence: [{
      filename: String,
      r2Key: String,
      r2Url: String,
    }],
    sellerResponse: { type: String, trim: true, maxlength: 3000 },
    sellerEvidence: [{
      filename: String,
      r2Key: String,
      r2Url: String,
    }],
    sellerRespondedAt: { type: Date },
    verdict: {
      type: String,
      enum: ['release_to_seller', 'partial_refund', 'full_refund_to_buyer'],
    },
    verdictReason: { type: String, trim: true },
    verdictBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verdictAt: { type: Date },
    partialRefundPercent: { type: Number, min: 0, max: 100 }, // used for partial refund
    adminNotes: { type: String },
  },

  // ─── REVIEWS ─────────────────────────────────────────────────────────────
  buyerReview: {
    rating: { type: Number, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 1000 },
    reviewedAt: Date,
  },
  sellerReview: {
    rating: { type: Number, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 1000 },
    reviewedAt: Date,
  },

  // ─── META ────────────────────────────────────────────────────────────────
  country: { type: String, default: 'PK', enum: ['PK', 'AE'] },
  isAutoApproved: { type: Boolean, default: false },
  adminNotes: { type: String },
  flagged: { type: Boolean, default: false },
  flagReason: { type: String },

}, { timestamps: true });

// ─── INDEXES ─────────────────────────────────────────────────────────────────
dealSchema.index({ buyer: 1, status: 1 });
dealSchema.index({ seller: 1, status: 1 });
dealSchema.index({ status: 1, autoApprovalDeadline: 1 }); // for cron job
dealSchema.index({ dealNumber: 1 });
dealSchema.index({ createdAt: -1 });
dealSchema.index({ status: 1, flagged: 1 }); // admin queries

// ─── AUTO-GENERATE DEAL NUMBER ────────────────────────────────────────────────
dealSchema.pre('save', async function (next) {
  if (!this.dealNumber) {
    const count = await mongoose.model('Deal').countDocuments();
    const year = new Date().getFullYear();
    this.dealNumber = `EPK-${year}-${String(count + 1).padStart(5, '0')}`;
  }
  next();
});

// ─── CALCULATE FEES ON SAVE ───────────────────────────────────────────────────
dealSchema.pre('save', function (next) {
  if (this.isModified('amountInPaisa') || this.isModified('platformFeePercent')) {
    this.platformFeeInPaisa = Math.round(this.amountInPaisa * (this.platformFeePercent / 100));
    this.sellerPayoutInPaisa = this.amountInPaisa - this.platformFeeInPaisa;
  }
  next();
});

// ─── VIRTUAL: formatted amount ────────────────────────────────────────────────
dealSchema.virtual('amountPKR').get(function () {
  return (this.amountInPaisa / 100).toLocaleString('en-PK');
});

dealSchema.virtual('sellerPayoutPKR').get(function () {
  return (this.sellerPayoutInPaisa / 100).toLocaleString('en-PK');
});

dealSchema.set('toJSON', { virtuals: true });
dealSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Deal', dealSchema);
module.exports.DEAL_STATUSES = DEAL_STATUSES;
