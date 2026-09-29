import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from './config/db';
import User from './models/User';
import Hotel from './models/Hotel';
import Guest from './models/Guest';
import Booking from './models/Booking';
import AuditLog from './models/AuditLog';
import CashHandover from './models/CashHandover';
import Payment from './models/Payment';
import Room from './models/Room';
import RoomType from './models/RoomType';

dotenv.config();

const resetDbAndSeed = async () => {
  try {
    await connectDB();
    
    await User.deleteMany({});
    await Hotel.deleteMany({});
    await Guest.deleteMany({});
    await Booking.deleteMany({});
    await AuditLog.deleteMany({});
    await CashHandover.deleteMany({});
    await Payment.deleteMany({});
    await Room.deleteMany({});
    await RoomType.deleteMany({});

    console.log(`Dropped all collections`);

    const superAdmin = await User.create({
      name: 'Master Super Administrator',
      email: 'admin@grandroyale.com',
      password: 'AdminPassword@123',
      phone: '+91 99999 88888',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      mustChangePassword: false,
      isDeleted: false,
    });
    console.log(`🎉 Master Super Admin created successfully!`);
    console.log(`   Email:    ${superAdmin.email}`);
    console.log(`   Password: AdminPassword@123`);
    process.exit(0);
  } catch (err) {
    console.error('Failed to reset DB:', err);
    process.exit(1);
  }
};
resetDbAndSeed();
