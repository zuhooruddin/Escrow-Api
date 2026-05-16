const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

// ─── TRANSPORT ────────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // TLS
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD, // App Password, NOT account password
  },
  tls: { rejectUnauthorized: false },
});

// ─── BRAND COLORS ─────────────────────────────────────────────────────────────
const BRAND = {
  navy: '#0A1628',
  green: '#10B981',
  gold: '#F59E0B',
  gray: '#6B7280',
  light: '#F9FAFB',
};

// ─── BASE EMAIL TEMPLATE ──────────────────────────────────────────────────────
function baseTemplate(title, content, ctaText, ctaUrl) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <!-- HEADER -->
        <tr><td style="background:${BRAND.navy};padding:28px 40px;border-radius:12px 12px 0 0;">
          <table width="100%"><tr>
            <td><span style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.5px;">Rakhwali <span style="color:${BRAND.green};">PK</span></span></td>
            <td align="right"><span style="font-size:12px;color:#94A3B8;">Trusted Escrow Platform</span></td>
          </tr></table>
        </td></tr>
        <!-- BODY -->
        <tr><td style="background:#fff;padding:40px;border:1px solid #E5E7EB;border-top:none;">
          ${content}
          ${ctaText && ctaUrl ? `
          <table width="100%" style="margin:32px 0;">
            <tr><td align="center">
              <a href="${ctaUrl}" style="background:${BRAND.green};color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">${ctaText}</a>
            </td></tr>
          </table>` : ''}
        </td></tr>
        <!-- FOOTER -->
        <tr><td style="background:${BRAND.navy};padding:24px 40px;border-radius:0 0 12px 12px;">
          <p style="margin:0;color:#94A3B8;font-size:12px;text-align:center;">
            Rakhwali PK — Pakistan's Trusted Escrow Platform<br>
            Questions? <a href="mailto:support@rakhwalipk.com" style="color:${BRAND.green};">support@rakhwalipk.com</a><br>
            <span style="margin-top:8px;display:block;">© 2024 Rakhwali PK. All rights reserved.</span>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function dealInfoBox(deal) {
  const amount = deal.amountInPaisa ? `Rs. ${(deal.amountInPaisa / 100).toLocaleString()}` : '';
  return `
  <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:20px;margin:24px 0;">
    <table width="100%">
      <tr>
        <td style="padding:6px 0;"><span style="color:#6B7280;font-size:13px;">Deal #</span><br><strong style="color:#0A1628;">${deal.dealNumber || ''}</strong></td>
        <td style="padding:6px 0;"><span style="color:#6B7280;font-size:13px;">Amount</span><br><strong style="color:#10B981;font-size:18px;">${amount}</strong></td>
      </tr>
      <tr>
        <td colspan="2" style="padding:12px 0 0;border-top:1px solid #E2E8F0;"><span style="color:#6B7280;font-size:13px;">Deal Title</span><br><strong style="color:#0A1628;">${deal.title || ''}</strong></td>
      </tr>
    </table>
  </div>`;
}

// ─── SEND EMAIL ───────────────────────────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  try {
    await transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME || 'Rakhwali PK'}" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html,
    });
    logger.info(`Email sent to ${to}: ${subject}`);
    return true;
  } catch (err) {
    logger.error(`Email failed to ${to}: ${err.message}`);
    return false;
  }
}

// ─── SPECIFIC EMAIL FUNCTIONS ─────────────────────────────────────────────────
exports.sendEmailVerification = async (user, token) => {
  const url = `${process.env.FRONTEND_URL}/auth/verify-email/${token}`;
  await sendEmail({
    to: user.email,
    subject: 'Verify your Rakhwali PK account',
    html: baseTemplate(
      'Verify Email',
      `<h2 style="color:#0A1628;margin:0 0 8px;">Welcome to Rakhwali PK, ${user.fullName.split(' ')[0]}!</h2>
       <p style="color:#374151;line-height:1.6;">Please verify your email address to activate your account and start using our secure escrow platform.</p>
       <p style="color:#6B7280;font-size:13px;">This link expires in 24 hours.</p>`,
      'Verify Email Address', url
    ),
  });
};

exports.sendPasswordReset = async (user, token) => {
  const url = `${process.env.FRONTEND_URL}/auth/reset-password?token=${token}`;
  await sendEmail({
    to: user.email,
    subject: 'Rakhwali PK — Password Reset Request',
    html: baseTemplate(
      'Reset Password',
      `<h2 style="color:#0A1628;margin:0 0 8px;">Password Reset</h2>
       <p style="color:#374151;line-height:1.6;">You requested to reset your password. Click below to set a new password.</p>
       <p style="color:#991B1B;font-size:13px;background:#FEE2E2;padding:12px;border-radius:6px;">⚠ If you didn't request this, ignore this email and your password will remain unchanged.</p>
       <p style="color:#6B7280;font-size:13px;">Link expires in 1 hour.</p>`,
      'Reset Password', url
    ),
  });
};

exports.sendDealCreated = async (seller, deal) => {
  const url = `${process.env.FRONTEND_URL}/dashboard/deals/${deal._id}`;
  await sendEmail({
    to: seller.email,
    subject: `New Deal Invitation — ${deal.title}`,
    html: baseTemplate(
      'New Deal',
      `<h2 style="color:#0A1628;margin:0 0 8px;">You have a new deal invitation</h2>
       <p style="color:#374151;line-height:1.6;">You have been invited to a new escrow deal. Review the details and choose to accept or decline.</p>
       ${dealInfoBox(deal)}
       <p style="color:#6B7280;font-size:13px;">Once you accept, the buyer will be notified to deposit funds.</p>`,
      'Review Deal', url
    ),
  });
};

exports.sendSellerInvite = async (sellerEmail, deal, buyer) => {
  const registerUrl = `${process.env.FRONTEND_URL}/auth/register?email=${encodeURIComponent(sellerEmail)}`;
  const amount = deal.amountInPaisa ? `Rs. ${(deal.amountInPaisa / 100).toLocaleString()}` : '';
  await sendEmail({
    to: sellerEmail,
    subject: `${buyer.fullName} invited you to an escrow deal — ${deal.title}`,
    html: baseTemplate(
      'Deal Invitation',
      `<h2 style="color:#0A1628;margin:0 0 8px;">You've been invited to an escrow deal</h2>
       <p style="color:#374151;line-height:1.6;"><strong>${buyer.fullName}</strong> wants to use Rakhwali PK's secure escrow to pay you <strong style="color:#10B981;">${amount}</strong> for:</p>
       <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:20px;margin:20px 0;">
         <p style="margin:0;font-size:16px;font-weight:700;color:#0A1628;">${deal.title}</p>
         <p style="margin:8px 0 0;color:#6B7280;font-size:13px;">${deal.description ? deal.description.slice(0, 200) + (deal.description.length > 200 ? '…' : '') : ''}</p>
       </div>
       <p style="color:#374151;line-height:1.6;">To accept or decline this deal, create your free Rakhwali PK account. It only takes a minute — your email is already pre-filled.</p>
       <p style="color:#6B7280;font-size:13px;">Funds are held securely in escrow and only released to you once you deliver and the buyer approves.</p>`,
      'Create Account & View Deal', registerUrl
    ),
  });
};

exports.sendDealFunded = async (seller, deal) => {
  const url = `${process.env.FRONTEND_URL}/dashboard/deals/${deal._id}`;
  await sendEmail({
    to: seller.email,
    subject: `Funds Secured — Start Working on: ${deal.title}`,
    html: baseTemplate(
      'Funds Secured',
      `<h2 style="color:#10B981;margin:0 0 8px;">✅ Funds are secured in escrow!</h2>
       <p style="color:#374151;line-height:1.6;">The buyer has deposited funds. You can now begin working on the deal.</p>
       ${dealInfoBox(deal)}
       <p style="color:#374151;">Your payout of <strong style="color:#10B981;">Rs. ${(deal.sellerPayoutInPaisa / 100).toLocaleString()}</strong> will be released once the buyer approves your work.</p>`,
      'Start Working', url
    ),
  });
};

exports.sendDeliverySubmitted = async (buyer, deal) => {
  const url = `${process.env.FRONTEND_URL}/dashboard/deals/${deal._id}`;
  await sendEmail({
    to: buyer.email,
    subject: `Work Submitted — Review Required: ${deal.title}`,
    html: baseTemplate(
      'Review Work',
      `<h2 style="color:#0A1628;margin:0 0 8px;">The seller has submitted their work</h2>
       <p style="color:#374151;line-height:1.6;">Please review the delivered work and approve payment or raise a dispute within <strong>${process.env.AUTO_APPROVAL_DAYS || 5} days</strong>.</p>
       ${dealInfoBox(deal)}
       <div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:16px;margin:16px 0;">
         <p style="margin:0;color:#92400E;font-size:13px;">⏰ <strong>Important:</strong> If you don't act within ${process.env.AUTO_APPROVAL_DAYS || 5} days, payment will be automatically released to the seller.</p>
       </div>`,
      'Review & Approve', url
    ),
  });
};

exports.sendDealCompleted = async (user, deal, isSeller) => {
  await sendEmail({
    to: user.email,
    subject: `Deal Completed — ${deal.title}`,
    html: baseTemplate(
      'Deal Completed',
      `<h2 style="color:#10B981;margin:0 0 8px;">✅ Deal Completed Successfully!</h2>
       ${dealInfoBox(deal)}
       ${isSeller
         ? `<p style="color:#374151;">Your payout of <strong style="color:#10B981;">Rs. ${(deal.sellerPayoutInPaisa / 100).toLocaleString()}</strong> will reach your bank account within 24 hours.</p>`
         : `<p style="color:#374151;">Thank you for using Rakhwali PK. The seller's payment has been released.</p>`
       }`,
      'View Transaction', `${process.env.FRONTEND_URL}/dashboard/deals/${deal._id}`
    ),
  });
};

exports.sendDisputeOpened = async (user, deal, isBuyer) => {
  await sendEmail({
    to: user.email,
    subject: `Dispute Opened — ${deal.title}`,
    html: baseTemplate(
      'Dispute Opened',
      `<h2 style="color:#991B1B;margin:0 0 8px;">⚠ Dispute Opened</h2>
       ${dealInfoBox(deal)}
       <p style="color:#374151;line-height:1.6;">${
         isBuyer
           ? 'Your dispute has been submitted. Our admin team will review within 48 hours. Funds are frozen until a verdict is issued.'
           : 'The buyer has raised a dispute. Please respond with your evidence within ' + (process.env.DISPUTE_RESPONSE_DAYS || 3) + ' days. Funds are frozen.'
       }</p>`,
      'View Dispute', `${process.env.FRONTEND_URL}/dashboard/deals/${deal._id}`
    ),
  });
};

exports.sendDisputeResolved = async (user, deal, verdict, message) => {
  await sendEmail({
    to: user.email,
    subject: `Dispute Resolved — ${deal.title}`,
    html: baseTemplate(
      'Dispute Resolved',
      `<h2 style="color:#0A1628;margin:0 0 8px;">Dispute Resolution — Final Verdict</h2>
       ${dealInfoBox(deal)}
       <div style="background:#F0FDF4;border:1px solid #10B981;border-radius:8px;padding:16px;margin:16px 0;">
         <p style="margin:0;color:#065F46;font-size:14px;"><strong>Verdict:</strong> ${verdict}</p>
       </div>
       <p style="color:#374151;line-height:1.6;">${message}</p>`,
      'View Details', `${process.env.FRONTEND_URL}/dashboard/deals/${deal._id}`
    ),
  });
};
