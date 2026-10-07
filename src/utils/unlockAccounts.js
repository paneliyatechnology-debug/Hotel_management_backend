const mongoose = require('mongoose');

async function unlockAllAccounts() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/hotel_management');
    const result = await mongoose.connection.collection('users').updateMany(
      {},
      {
        $set: { failedLoginAttempts: 0 },
        $unset: { accountLockedUntil: 1 },
      }
    );
    console.log('✅ Success! Unlocked all user accounts in database:', result.modifiedCount);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error unlocking accounts:', err);
    process.exit(1);
  }
}

unlockAllAccounts();
