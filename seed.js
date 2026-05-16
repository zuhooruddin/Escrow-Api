require('dotenv').config();
require('./src/config/patchMongoDns');
const mongoose = require('mongoose');

async function seed() {
  console.log('🌱 Seeding EscrowPK database...');

  await mongoose.connect(process.env.MONGODB_URI, { family: 4 });
  console.log('✅ Connected to MongoDB Atlas');

  const User = require('./src/models/User');

  // ── CREATE OR ENSURE ADMIN ────────────────────────────────────────────────
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@escrowpk.com';
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@12345';
  const existing = await User.findOne({ email: adminEmail });

  if (existing) {
    if (existing.role !== 'admin') {
      await User.updateOne(
        { _id: existing._id },
        {
          $set: {
            role: 'admin',
            isEmailVerified: true,
            isActive: true,
            'kyc.status': 'approved',
          },
        }
      );
      console.log(`✅ Promoted existing user to admin: ${adminEmail} (password unchanged)`);
    } else {
      console.log(`ℹ️  Admin already exists: ${adminEmail}`);
    }
  } else {
    await User.create({
      fullName: 'EscrowPK Admin',
      email: adminEmail,
      phone: '03001234567',
      password: adminPassword,
      role: 'admin',
      isEmailVerified: true,
      isActive: true,
      kyc: { status: 'approved' },
    });
    console.log(`✅ Admin created: ${adminEmail}`);
    console.log(`   Password: ${adminPassword}`);
    console.log('   ⚠️  Change this password immediately after first login!');
  }

  // ── CREATE TEST BUYER ─────────────────────────────────────────────────────
  const buyerEmail = 'buyer@test.com';
  const buyer = await User.findOne({ email: buyerEmail });
  if (!buyer) {
    await User.create({
      fullName: 'Ali Hassan',
      email: buyerEmail,
      phone: '03011111111',
      password: 'Test@12345',
      role: 'both',
      isEmailVerified: true,
      kyc: { status: 'approved', documentType: 'CNIC', documentNumber: '42201-1234567-1' },
      bankDetails: { bankName: 'HBL', accountTitle: 'Ali Hassan', iban: 'PK55HBL0000000000001234', accountNumber: '00001234' },
    });
    console.log('✅ Test buyer: buyer@test.com / Test@12345');
  }

  // ── CREATE TEST SELLER ────────────────────────────────────────────────────
  const sellerEmail = 'seller@test.com';
  const seller = await User.findOne({ email: sellerEmail });
  if (!seller) {
    await User.create({
      fullName: 'Bilal Khan',
      email: sellerEmail,
      phone: '03022222222',
      password: 'Test@12345',
      role: 'both',
      isEmailVerified: true,
      kyc: { status: 'approved', documentType: 'CNIC', documentNumber: '35201-9876543-9' },
      bankDetails: { bankName: 'Meezan Bank', accountTitle: 'Bilal Khan', iban: 'PK36MEZN0001234567890123', accountNumber: '01234567890' },
    });
    console.log('✅ Test seller: seller@test.com / Test@12345');
  }

  console.log('\n🎉 Seeding complete!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Admin Panel:    http://localhost:3000/admin');
  console.log(`Admin Login:    ${adminEmail}`);
  console.log('Buyer Test:     buyer@test.com / Test@12345');
  console.log('Seller Test:    seller@test.com / Test@12345');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
