const crypto = require('crypto');

// ─── GENERATE JAZZCASH PAYMENT REQUEST ───────────────────────────────────────
exports.generatePaymentRequest = ({ amount, txnRef, description, mobileNumber, dealId }) => {
  const datetime = new Date().toISOString().replace(/[-:T.Z]/g, '').substring(0, 14);
  const expiryDate = new Date(Date.now() + 3600000).toISOString().replace(/[-:T.Z]/g, '').substring(0, 14);

  const params = {
    pp_Version: '1.1',
    pp_TxnType: 'MWALLET',
    pp_Language: 'EN',
    pp_MerchantID: process.env.JAZZCASH_MERCHANT_ID,
    pp_SubMerchantID: '',
    pp_Password: process.env.JAZZCASH_PASSWORD,
    pp_BankID: 'TBANK',
    pp_ProductID: 'RETL',
    pp_TxnRefNo: txnRef,
    pp_Amount: Math.round(parseFloat(amount) * 100).toString(), // JazzCash uses paisas
    pp_TxnCurrency: 'PKR',
    pp_TxnDateTime: datetime,
    pp_BillReference: `escrow-${dealId}`,
    pp_Description: description.substring(0, 100),
    pp_TxnExpiryDateTime: expiryDate,
    pp_ReturnURL: process.env.JAZZCASH_RETURN_URL,
    pp_MobileNumber: mobileNumber,
    pp_CNIC: '',
    ppmpf_1: dealId,
  };

  // Generate HMAC-SHA256 signature
  params.pp_SecureHash = generateHMAC(params);

  return {
    formData: params,
    actionUrl: process.env.JAZZCASH_API_URL,
  };
};

// ─── VERIFY WEBHOOK SIGNATURE ─────────────────────────────────────────────────
exports.verifyWebhook = (payload) => {
  const receivedHash = payload.pp_SecureHash;
  if (!receivedHash) return false;

  const payloadWithoutHash = { ...payload };
  delete payloadWithoutHash.pp_SecureHash;

  const expectedHash = generateHMAC(payloadWithoutHash);
  return receivedHash === expectedHash;
};

function generateHMAC(params) {
  const salt = process.env.JAZZCASH_INTEGRITY_SALT;
  const sortedKeys = Object.keys(params).sort();
  const values = sortedKeys.map(k => params[k]).filter(v => v !== '');
  const hashString = salt + '&' + values.join('&');
  return crypto.createHmac('sha256', salt).update(hashString).digest('hex').toUpperCase();
}
