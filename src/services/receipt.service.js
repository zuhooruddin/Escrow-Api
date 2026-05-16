const PDFDocument = require('pdfkit');

// ─── GENERATE PDF RECEIPT BUFFER ─────────────────────────────────────────────
exports.generateReceiptPDF = (deal) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];

    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const darkGreen  = '#0d2a1f';
    const gold       = '#c9a15a';
    const lightGrey  = '#f5f3ee';
    const mutedText  = '#666666';
    const lineColor  = '#e0ddd4';

    const amountPKR      = (deal.amountInPaisa / 100).toLocaleString('en-PK');
    const feePKR         = (deal.platformFeeInPaisa / 100).toLocaleString('en-PK');
    const payoutPKR      = (deal.sellerPayoutInPaisa / 100).toLocaleString('en-PK');
    const completedDate  = deal.completedAt ? new Date(deal.completedAt).toLocaleDateString('en-PK', { dateStyle: 'long' }) : '';
    const createdDate    = new Date(deal.createdAt).toLocaleDateString('en-PK', { dateStyle: 'long' });

    // ── HEADER ──────────────────────────────────────────────────────────────
    doc.rect(0, 0, 595, 110).fill(darkGreen);

    doc.fontSize(22).font('Helvetica-Bold').fillColor('#ffffff')
      .text('Rakhwali PK', 50, 30);
    doc.fontSize(10).font('Helvetica').fillColor('rgba(255,255,255,0.6)')
      .text('Secure Escrow Platform — Pakistan', 50, 58);

    doc.fontSize(10).font('Helvetica').fillColor(gold)
      .text('TRANSACTION RECEIPT', 50, 80);

    // Deal number top-right
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff')
      .text(deal.dealNumber || '', 345, 40, { width: 200, align: 'right' });
    doc.fontSize(8).font('Helvetica').fillColor('rgba(255,255,255,0.5)')
      .text('Deal Number', 345, 56, { width: 200, align: 'right' });

    // ── STATUS BADGE ─────────────────────────────────────────────────────────
    doc.roundedRect(50, 125, 100, 22, 4).fill('#e8f5e9');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#2e7d32')
      .text('COMPLETED', 55, 131, { width: 90, align: 'center' });

    doc.fontSize(9).font('Helvetica').fillColor(mutedText)
      .text(`Completed on ${completedDate}`, 165, 131);

    // ── DEAL INFO ─────────────────────────────────────────────────────────────
    doc.moveTo(50, 162).lineTo(545, 162).strokeColor(lineColor).stroke();

    doc.fontSize(14).font('Helvetica-Bold').fillColor(darkGreen)
      .text(deal.title, 50, 175, { width: 495 });
    doc.fontSize(10).font('Helvetica').fillColor(mutedText)
      .text(`Category: ${deal.category || 'General'} · Created ${createdDate}`, 50, 198);

    // ── PARTIES ───────────────────────────────────────────────────────────────
    doc.moveTo(50, 225).lineTo(545, 225).strokeColor(lineColor).stroke();

    const col1 = 50, col2 = 300;
    const rowY  = 238;

    doc.fontSize(8).font('Helvetica-Bold').fillColor(mutedText)
      .text('BUYER', col1, rowY)
      .text('SELLER', col2, rowY);

    doc.fontSize(11).font('Helvetica-Bold').fillColor(darkGreen)
      .text(deal.buyer?.fullName || 'N/A', col1, rowY + 14)
      .text(deal.seller?.fullName || 'N/A', col2, rowY + 14);

    doc.fontSize(9).font('Helvetica').fillColor(mutedText)
      .text(deal.buyer?.email || '', col1, rowY + 30)
      .text(deal.seller?.email || '', col2, rowY + 30);

    // ── FINANCIAL BREAKDOWN ───────────────────────────────────────────────────
    doc.moveTo(50, 302).lineTo(545, 302).strokeColor(lineColor).stroke();

    doc.fontSize(9).font('Helvetica-Bold').fillColor(mutedText)
      .text('FINANCIAL BREAKDOWN', 50, 314);

    const rows = [
      { label: 'Deal Amount',    value: `Rs. ${amountPKR}`,  bold: false },
      { label: `Platform Fee (${deal.platformFeePercent}%)`, value: `- Rs. ${feePKR}`, bold: false },
    ];

    let fy = 332;
    rows.forEach(({ label, value }) => {
      doc.fontSize(10).font('Helvetica').fillColor('#333')
        .text(label, 50, fy)
        .text(value, 345, fy, { width: 200, align: 'right' });
      fy += 22;
    });

    // Payout line with background
    doc.rect(50, fy, 495, 32).fill('#f0fdf4');
    doc.fontSize(12).font('Helvetica-Bold').fillColor(darkGreen)
      .text('Seller Payout', 60, fy + 9)
      .text(`Rs. ${payoutPKR}`, 345, fy + 9, { width: 190, align: 'right' });
    fy += 46;

    // ── PAYMENT METHOD ────────────────────────────────────────────────────────
    if (deal.payment?.method) {
      doc.moveTo(50, fy).lineTo(545, fy).strokeColor(lineColor).stroke();
      fy += 14;

      const methodLabels = { jazzcash: 'JazzCash', easypaisa: 'EasyPaisa', bank_transfer: 'Bank Transfer (IBFT)' };
      doc.fontSize(8).font('Helvetica-Bold').fillColor(mutedText).text('PAYMENT METHOD', 50, fy);
      doc.fontSize(10).font('Helvetica').fillColor(darkGreen)
        .text(methodLabels[deal.payment.method] || deal.payment.method, 50, fy + 14);

      if (deal.payment.transactionId) {
        doc.fontSize(8).font('Helvetica').fillColor(mutedText)
          .text(`Transaction ID: ${deal.payment.transactionId}`, 50, fy + 30);
      }
      fy += 55;
    }

    // ── DISPUTE NOTE ──────────────────────────────────────────────────────────
    if (deal.isAutoApproved) {
      doc.rect(50, fy, 495, 30).fill('#fff8e1');
      doc.fontSize(9).font('Helvetica').fillColor('#795548')
        .text('⚡ Auto-approved by system — buyer did not respond within the review period.', 60, fy + 10);
      fy += 44;
    }

    // ── FOOTER ────────────────────────────────────────────────────────────────
    doc.rect(0, 750, 595, 92).fill(darkGreen);
    doc.fontSize(8).font('Helvetica').fillColor('rgba(255,255,255,0.5)')
      .text('This receipt is automatically generated by Rakhwali PK and is valid without a signature.', 50, 762, { width: 495, align: 'center' })
      .text('For disputes or queries contact support@rakhwalipk.com', 50, 778, { width: 495, align: 'center' })
      .text(`© ${new Date().getFullYear()} Rakhwali PK Contributors Pvt. Ltd. — Pakistan`, 50, 794, { width: 495, align: 'center' });

    doc.end();
  });
};
