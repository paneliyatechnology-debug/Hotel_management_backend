import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from './config/db';
import User from './models/User';

dotenv.config();

const seedMasterSuperAdmin = async (): Promise<void> => {
  try {
    await connectDB();

    const args = process.argv.slice(2);
    const superAdminEmail = args[0] || process.env.SUPER_ADMIN_EMAIL || 'superadmin@hotelmgmt.com';
    const superAdminPassword = args[1] || process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@2026';
    const superAdminName = args[2] || 'Master Super Administrator';

    let existingSuperAdmin = await User.findOne({ email: superAdminEmail.toLowerCase() });

    if (existingSuperAdmin) {
      existingSuperAdmin.name = superAdminName;
      existingSuperAdmin.role = 'SUPER_ADMIN';
      existingSuperAdmin.status = 'ACTIVE';
      existingSuperAdmin.password = superAdminPassword; // mongoose pre-save hook will hash it
      existingSuperAdmin.isDeleted = false;
      await existingSuperAdmin.save();
      console.log(`👑 Master Super Admin updated successfully!`);
      console.log(`   Email:    ${existingSuperAdmin.email}`);
      console.log(`   Password: ${superAdminPassword}`);
    } else {
      const superAdmin = await User.create({
        name: superAdminName,
        email: superAdminEmail.toLowerCase(),
        password: superAdminPassword,
        phone: '+91 99999 88888',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        mustChangePassword: false,
        isDeleted: false,
      });
      console.log(`🎉 Master Super Admin created successfully!`);
      console.log(`   Email:    ${superAdmin.email}`);
      console.log(`   Password: ${superAdminPassword}`);
    }

    process.exit(0);
  } catch (error: any) {
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  }
};

seedMasterSuperAdmin();
