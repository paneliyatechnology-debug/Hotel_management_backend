import { Request, Response } from 'express';
import crypto from 'crypto';
import Hotel from '../models/Hotel';
import User from '../models/User';
import sendEmail from '../utils/sendEmail';
import { hotelApprovedEmailTemplate } from '../utils/emailTemplates';

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

    // Check if owner email or hotel already exists
    const existingHotel = await Hotel.findOne({ ownerEmail: ownerEmail.toLowerCase() });
    if (existingHotel) {
      res.status(400).json({
        success: false,
        message: 'A hotel is already registered with this owner email address.',
      });
      return;
    }

    const trialStart = new Date();
    const trialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 Days Free Trial

    // Create the Hotel with ACTIVE status & 30-Day trial
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

    const loginUrl = process.env.ADMIN_URL || 'http://localhost:3001';

    // Send Credentials Email to Hotel Owner immediately
    try {
      await sendEmail({
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
      });
    } catch (emailError: any) {
      console.warn('Credentials email failed to send:', emailError.message);
    }

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
