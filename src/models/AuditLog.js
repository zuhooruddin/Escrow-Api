const mongoose = require('mongoose');

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────
// Records every deal status change — MANDATORY for dispute resolution
const auditLogSchema = new mongoose.Schema({
  deal: { type: mongoose.Schema.Types.ObjectId, ref: 'Deal', required: true },
  fromStatus: { type: String, required: true },
  toStatus: { type: String, required: true },
  triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // null = system
  triggeredByRole: { type: String, enum: ['buyer', 'seller', 'admin', 'system'] },
  action: { type: String, required: true }, // human-readable description
  metadata: { type: mongoose.Schema.Types.Mixed }, // extra context
  ipAddress: { type: String },
  userAgent: { type: String },
  timestamp: { type: Date, default: Date.now },
}, {
  timestamps: false,
  // Audit logs must NEVER be deleted
  collection: 'audit_logs',
});

auditLogSchema.index({ deal: 1, timestamp: 1 });
auditLogSchema.index({ triggeredBy: 1 });
auditLogSchema.index({ timestamp: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

// ─── NOTIFICATION ─────────────────────────────────────────────────────────────
const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: [
      'deal_created', 'deal_accepted', 'deal_declined', 'deal_funded',
      'deal_delivered', 'deal_approved', 'deal_completed', 'deal_auto_approved',
      'deal_cancelled', 'dispute_opened', 'dispute_response', 'dispute_resolved',
      'payment_received', 'payout_initiated', 'payout_completed',
      'review_reminder', 'deadline_warning', 'kyc_approved', 'kyc_rejected',
      'account_suspended', 'system',
    ],
    required: true,
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  deal: { type: mongoose.Schema.Types.ObjectId, ref: 'Deal' },
  isRead: { type: Boolean, default: false },
  readAt: { type: Date },
  channels: {
    inApp: { sent: Boolean, sentAt: Date },
    email: { sent: Boolean, sentAt: Date, error: String },
    sms: { sent: Boolean, sentAt: Date, error: String },
  },
}, { timestamps: true });

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ deal: 1 });

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = { AuditLog, Notification };
