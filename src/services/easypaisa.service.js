const crypto = require('crypto');

exports.generatePaymentRequest = ({ amount, txnRef, mobileNumber, dealId }) => {
  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').substring(0, 14);
  const params = {
    storeId: process.env.EASYPAISA_STORE_ID,
    amount: parseFloat(amount).toFixed(2),
    postBackURL: process.env.EASYPAISA_RETURN_URL,
    orderRefNum: txnRef,
    expiryDate: new Date(Date.now() + 3600000).toISOString().split('T')[0].replace(/-/g, '') + '235959',
    autoRedirect: '0',
    paymentMethod: 'MA_PAYMENT',
    mobileNum: mobileNumber,
    emailAddr: '',
    merchantPaymentMethod: 'MA_PAYMENT',
    recurringPayment: '0',
    storeIdHashValue: '',
  };

  const hashData = `${params.amount}${params.expiryDate}${params.merchantPaymentMethod}${params.orderRefNum}${params.postBackURL}${params.recurringPayment}${process.env.EASYPAISA_STORE_ID}${process.env.EASYPAISA_HASH_KEY}`;
  params.storeIdHashValue = crypto.createHash('sha256').update(hashData).digest('hex').toUpperCase();

  return { params, actionUrl: process.env.EASYPAISA_API_URL };
};

exports.verifyWebhook = (payload) => {
  try {
    const { storeId, orderRefNum, transactionStatus, amount, signature } = payload;
    const expected = crypto.createHash('sha256')
      .update(`${amount}${orderRefNum}${storeId}${transactionStatus}${process.env.EASYPAISA_HASH_KEY}`)
      .digest('hex').toUpperCase();
    return signature === expected;
  } catch {
    return false;
  }
};
