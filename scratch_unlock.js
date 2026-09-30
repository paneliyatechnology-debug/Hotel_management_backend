const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/hotel_management';

async function unlockAllAccounts() {
  try {
    await mongoose.connect(MONGO_URI);
    const result = await mongoose.connection.collection('users').updateMany(
      {},
      {
        $unset: { accountLockedUntil: 1 },
        $set: { failedLoginAttempts: 0 }
      }
    );
    console.log('✅ UNLOCKED_ALL_ACCOUNTS_SUCCESS:', result);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error unlocking accounts:', err);
    process.exit(1);
  }
}

unlockAllAccounts();
