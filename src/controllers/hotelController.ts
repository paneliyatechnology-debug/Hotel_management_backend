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
    const cleanEmail = ownerEmail.toLowerCase().trim();

    // Check if hotel already exists for this owner email, or create new
    let hotel = await Hotel.findOne({ ownerEmail: cleanEmail });

    const trialStart = new Date();
    let settings = await SystemSettings.findOne();
    if (!settings) {
      settings = await SystemSettings.create({ freeTrialValue: 30, freeTrialUnit: 'days' });
    }

    let trialEnd = new Date(trialStart);
    if (settings?.freeTrialUnit === 'hours') {
      trialEnd.setHours(trialEnd.getHours() + settings.freeTrialValue);
    } else {
      trialEnd.setDate(trialEnd.getDate() + (settings?.freeTrialValue || 30));
    }

    if (hotel) {
      // Update existing hotel
      hotel.name = name;
      hotel.ownerName = ownerName;
      hotel.ownerPhone = ownerPhone;
      hotel.address = address;
      hotel.city = city;
      hotel.state = state;
      hotel.pincode = pincode;
      hotel.totalRooms = totalRooms ? Number(totalRooms) : hotel.totalRooms;
      hotel.status = 'ACTIVE';
      await hotel.save();
    } else {
      // Create new hotel
      hotel = await Hotel.create({
        name,
        ownerName,
        ownerEmail: cleanEmail,
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
    }

    // Determine password: use user-provided password or generate a name-related password (e.g. Ramesh@123)
    let finalPassword = req.body.password && req.body.password.trim().length >= 4 ? req.body.password.trim() : '';

    if (!finalPassword) {
      const cleanFirstName = (ownerName || name || 'Admin').trim().split(' ')[0].replace(/[^a-zA-Z0-9]/g, '');
      const capitalizedName = cleanFirstName
        ? cleanFirstName.charAt(0).toUpperCase() + cleanFirstName.slice(1)
        : 'Admin';
      finalPassword = `${capitalizedName}@123`;
    }

    // Create or update the Hotel Admin user account
    let adminUser = await User.findOne({ email: cleanEmail });
    if (!adminUser) {
      adminUser = await User.create({
        name: hotel.ownerName,
        email: cleanEmail,
        password: finalPassword,
        phone: hotel.ownerPhone,
        role: 'HOTEL_ADMIN',
        hotel: hotel._id,
        status: 'ACTIVE',
        mustChangePassword: false,
        failedLoginAttempts: 0,
      });
    } else {
      adminUser.name = hotel.ownerName;
      adminUser.password = finalPassword;
      adminUser.role = 'HOTEL_ADMIN';
      adminUser.hotel = hotel._id as any;
      adminUser.status = 'ACTIVE';
      adminUser.mustChangePassword = false;
      adminUser.failedLoginAttempts = 0;
      adminUser.accountLockedUntil = undefined;
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
        temporaryPassword: finalPassword,
        trialStartDate: new Date().toLocaleDateString(),
        trialEndDate: trialEnd.toLocaleDateString(),
        loginUrl,
      }),
    }).catch((emailError: any) => {
      console.warn('Credentials email failed to send:', emailError.message);
    });

    res.status(201).json({
      success: true,
      message: 'Hotel registered and activated with 30-Day Free Trial! Your login credentials have been set.',
      credentials: {
        email: hotel.ownerEmail,
        password: finalPassword,
      },
      data: {
        _id: hotel._id,
        name: hotel.name,
        slug: hotel.slug,
        status: hotel.status,
        ownerEmail: hotel.ownerEmail,
        generatedPassword: finalPassword,
        trialEndDate: trialEnd,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
