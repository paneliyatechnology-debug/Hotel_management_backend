import { Request, Response } from 'express';
import crypto from 'crypto';
import Hotel from '../models/Hotel';
import User from '../models/User';
import SystemSettings from '../models/SystemSettings';
import sendEmail from '../utils/sendEmail';
import { hotelApprovedEmailTemplate } from '../utils/emailTemplates';
import { checkEmailExistsGlobally } from '../utils/emailValidator';

// @desc    Register a new Hotel & Immediately activate 30-Day Free Trial + send credentials
// @route   POST /api/v1/hotels/register
export const registerHotel = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      name,
      ownerName,
      ownerEmail,
      ownerPhone,
      address,
      city,
      state,
      country,
      pincode,
      gstNumber,
      panNumber,
      totalRooms,
      hotelType,
      website,
      logo,
      idProofDocument,
      businessProofDocument,
    } = req.body;

    if (!name || !ownerName || !ownerEmail || !ownerPhone || !address || !city || !state || !pincode) {
      res.status(400).json({
        success: false,
        message: 'Please fill all required hotel registration fields (name, ownerName, ownerEmail, ownerPhone, address, city, state, pincode).',
      });
      return;
    }

    // Check if owner email or hotel already exists globally
    const isEmailUsed = await checkEmailExistsGlobally(ownerEmail);
    if (isEmailUsed) {
      res.status(400).json({
        success: false,
        message: 'This email is already registered in the system (either as a user, guest, or another hotel owner). Please use a different email.',
      });
      return;
    }

    const trialStart = new Date();
    let settings = await SystemSettings.findOne();
    if (!settings) {
      settings = await SystemSettings.create({ freeTrialValue: 30, freeTrialUnit: 'days' });
    }

    let trialEnd = new Date(trialStart);
    if (settings.freeTrialUnit === 'hours') {
      trialEnd.setHours(trialEnd.getHours() + settings.freeTrialValue);
    } else {
      trialEnd.setDate(trialEnd.getDate() + settings.freeTrialValue);
    }

    // Create the Hotel with ACTIVE status & dynamic trial
    const hotel = await Hotel.create({
      name,
      ownerName,
      ownerEmail: ownerEmail.toLowerCase(),
      ownerPhone,
      address,
      city,
      state,
      country: country || 'India',
      pincode,
      gstNumber: gstNumber || '',
      panNumber: panNumber || '',
      totalRooms: totalRooms ? Number(totalRooms) : 0,
      hotelType: hotelType || 'Boutique Hotel',
      website: website || '',
      logo: logo || '',
      idProofDocument: idProofDocument || '',
      businessProofDocument: businessProofDocument || '',
      status: 'ACTIVE',
      subscription: {
        plan: 'TRIAL',
        status: 'TRIAL',
        trialStartDate: trialStart,
        trialEndDate: trialEnd,
        autoRenew: false,
      },
    });

    // Generate secure temporary password for the Hotel Admin
    const rawTempPassword = 'Adm@' + crypto.randomBytes(4).toString('hex') + '#26';

    // Create or update the Hotel Admin user account
    let adminUser = await User.findOne({ email: hotel.ownerEmail.toLowerCase() });
    if (!adminUser) {
      adminUser = await User.create({
        name: hotel.ownerName,
        email: hotel.ownerEmail.toLowerCase(),
        password: rawTempPassword,
        phone: hotel.ownerPhone,
        role: 'HOTEL_ADMIN',
        hotel: hotel._id,
        status: 'ACTIVE',
        mustChangePassword: true,
      });
    } else {
      adminUser.password = rawTempPassword;
      adminUser.role = 'HOTEL_ADMIN';
      adminUser.hotel = hotel._id as any;
      adminUser.status = 'ACTIVE';
      adminUser.mustChangePassword = true;
      await adminUser.save();
    }

    const loginUrl = process.env.ADMIN_URL || 'https://hotel-management-admin-livid.vercel.app';

    // Send Credentials Email to Hotel Owner asynchronously (non-blocking)
    sendEmail({
      email: hotel.ownerEmail,
      subject: `🎉 Congratulations! ${hotel.name} Registered - Your Admin Credentials`,
      html: hotelApprovedEmailTemplate({
        hotelName: hotel.name,
        ownerName: hotel.ownerName,
        adminEmail: hotel.ownerEmail,
        temporaryPassword: rawTempPassword,
        trialStartDate: new Date().toLocaleDateString(),
        trialEndDate: trialEnd.toLocaleDateString(),
        loginUrl,
      }),
    }).catch((emailError: any) => {
      console.warn('Credentials email failed to send:', emailError.message);
    });

    res.status(201).json({
      success: true,
      message: 'Hotel registered and activated with 30-Day Free Trial! Your login credentials have been sent to your email.',
      data: {
        _id: hotel._id,
        name: hotel.name,
        slug: hotel.slug,
        status: hotel.status,
        ownerEmail: hotel.ownerEmail,
        trialEndDate: trialEnd,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
