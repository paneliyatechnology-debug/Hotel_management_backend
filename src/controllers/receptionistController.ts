import { Response } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import Room from '../models/Room';
import RoomType from '../models/RoomType';
import Guest from '../models/Guest';
import Booking from '../models/Booking';
import BookingCharge from '../models/BookingCharge';
import Payment from '../models/Payment';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import sendEmail from '../utils/sendEmail';
import logAuditAction from '../utils/auditLogger';
import { paymentReceiptTemplate, guestBookingConfirmationTemplate } from '../utils/emailTemplates';
import { extractAndVerifyAadhaarOCR, extractAndVerifyDrivingLicense } from '../utils/surepassService';
import { emitToHotel } from '../utils/socketService';
import { uploadToCloudinary } from '../utils/cloudinary';
import { checkEmailExistsGlobally } from '../utils/emailValidator';
import { calculateMultiRoomBookingGST } from '../utils/gstUtils';
import {
  toISODateString,
  formatShortDate,
  isDateRangeOverlapping,
  findOverlappingBookings,
} from '../utils/bookingAvailability';

import { autoCompleteExpiredCleaningRooms } from '../utils/housekeepingService';

// @desc    Helper to auto-resolve rooms whose cleaning timer expired (100% complete)
export const resolveCleaningRooms = async (hotelId: any): Promise<void> => {
  try {
    await autoCompleteExpiredCleaningRooms(hotelId);
  } catch (err) {
    console.error('Error auto-resolving cleaning rooms:', err);
  }
};

// @desc    Get Receptionist Operational Dashboard Telemetry
// @route   GET /api/v1/receptionist/dashboard
export const getReceptionistDashboard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const hotelId = req.hotelId;
    await resolveCleaningRooms(hotelId);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // Available Rooms Count
    const availableRooms = await Room.countDocuments({ hotel: hotelId, status: 'AVAILABLE', isActive: true });
    const cleaningRooms = await Room.countDocuments({ hotel: hotelId, status: 'CLEANING', isActive: true });
    const currentGuests = await Booking.countDocuments({ hotel: hotelId, status: 'CHECKED_IN' });

    // Today Arrivals & Departures
    const todayArrivals = await Booking.find({
      hotel: hotelId,
      checkInDate: { $gte: startOfToday, $lte: endOfToday },
      status: { $in: ['CONFIRMED', 'PENDING'] },
    })
      .populate('guest', 'fullName mobileNumber')
      .populate('room', 'roomNumber');

    const todayDepartures = await Booking.find({
      hotel: hotelId,
      checkOutDate: { $gte: startOfToday, $lte: endOfToday },
      status: 'CHECKED_IN',
    })
      .populate('guest', 'fullName mobileNumber')
      .populate('room', 'roomNumber');

    // Today Cash & Online Collections
    const todayShiftPayments = await Payment.aggregate([
      {
        $match: {
          hotel: req.user?.hotel,
          paymentStatus: 'PAID',
          createdAt: { $gte: startOfToday, $lte: endOfToday },
        },
      },
      {
        $group: {
          _id: '$paymentMethod',
          total: { $sum: '$amount' },
        },
      },
    ]);

    let todayCash = 0;
    let todayOnline = 0;
    todayShiftPayments.forEach((p) => {
      if (p._id === 'CASH') todayCash += p.total;
      else todayOnline += p.total;
    });

    res.status(200).json({
      success: true,
      data: {
        rooms: {
          available: availableRooms,
          cleaning: cleaningRooms,
          currentGuests,
        },
        collections: {
          todayCash,
          todayOnline,
          totalToday: todayCash + todayOnline,
        },
        todayArrivals,
        todayDepartures,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Helper to compute available rooms list with dynamic stay dates & booking availability
export const fetchAvailableRoomsData = async (hotelId: any, queryParams: any) => {
  await resolveCleaningRooms(hotelId);
  const { roomType, checkInDate, checkOutDate, checkIn, checkOut } = queryParams || {};

  const todayStr = toISODateString(new Date());
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = toISODateString(tomorrowDate);

  const cInVal = checkInDate || checkIn;
  const cOutVal = checkOutDate || checkOut;

  // Normalize requested date boundaries
  const reqInStr = cInVal ? toISODateString(String(cInVal)) : todayStr;
  let reqOutStr = cOutVal ? toISODateString(String(cOutVal)) : '';
  if (!reqOutStr || reqOutStr <= reqInStr) {
    const dIn = new Date(reqInStr);
    dIn.setDate(dIn.getDate() + 1);
    reqOutStr = toISODateString(dIn);
  }

  const query: any = { hotel: hotelId, isActive: true, isDeleted: { $ne: true } };
  if (roomType) query.roomType = roomType;

  const rooms = await Room.find(query).populate('roomType').sort({ roomNumber: 1 });

  // Lookup ALL active bookings (CONFIRMED, CHECKED_IN, PENDING, RESERVED) for this hotel
  const activeBookings = await Booking.find({
    hotel: hotelId,
    status: { $nin: ['CANCELLED', 'CHECKED_OUT', 'NO_SHOW', 'VOID', 'REFUNDED'] },
    isDeleted: { $ne: true },
  }).populate('guest', 'fullName mobileNumber email');

  // Index bookings by roomId and roomNumber
  const bookingsByRoom: { [key: string]: any[] } = {};
  activeBookings.forEach((b: any) => {
    const g = b.guest as any;
    const guestName = g?.fullName || g?.name || b.guestName || 'Guest';

    const bookingInfo = {
      _id: b._id,
      bookingNumber: b.bookingNumber,
      status: b.status,
      checkInDate: toISODateString(b.checkInDate),
      checkOutDate: toISODateString(b.checkOutDate),
      guestName,
      guestPhone: g?.mobileNumber || b.guestPhone || '',
    };

    const keys: string[] = [];
    if (b.room) keys.push(b.room.toString());
    if (Array.isArray(b.rooms)) {
      b.rooms.forEach((rId: any) => {
        if (rId) keys.push(rId.toString());
      });
    }

    const bRtId = b.roomType?._id?.toString() || b.roomType?.toString() || "";
    if (b.roomNumber && (!b.room || keys.length === 0)) {
      if (bRtId) keys.push(`num_${bRtId}_${b.roomNumber}`);
      else keys.push(`num_${b.roomNumber}`);
    }
    if (Array.isArray(b.roomNumbers) && (!b.rooms || b.rooms.length === 0)) {
      b.roomNumbers.forEach((rNum: any) => {
        if (rNum) {
          if (bRtId) keys.push(`num_${bRtId}_${rNum}`);
          else keys.push(`num_${rNum}`);
        }
      });
    }

    keys.forEach((k) => {
      if (!bookingsByRoom[k]) bookingsByRoom[k] = [];
      bookingsByRoom[k].push(bookingInfo);
    });
  });

  const enrichedRooms = rooms.map((r: any) => {
    const rObj = r.toObject();
    const rId = r._id.toString();
    const rRtId = r.roomType?._id?.toString() || r.roomType?.toString() || "";
    const rNumKey = rRtId ? `num_${rRtId}_${r.roomNumber}` : `num_${r.roomNumber}`;

    const allRoomBookings = [
      ...(bookingsByRoom[rId] || []),
      ...((!bookingsByRoom[rId] || bookingsByRoom[rId].length === 0) ? (bookingsByRoom[rNumKey] || []) : []),
    ].filter((v, i, a) => a.findIndex((t) => String(t.bookingNumber) === String(v.bookingNumber)) === i);

    // 1. Current In-House / Today Status
    const todayBooking = allRoomBookings.find(
      (b) => b.status === 'CHECKED_IN' || isDateRangeOverlapping(todayStr, tomorrowStr, b.checkInDate, b.checkOutDate)
    );

    // 2. Overlapping bookings for the REQUESTED stay period [reqInStr, reqOutStr)
    const overlappingBookings = allRoomBookings.filter((b) =>
      isDateRangeOverlapping(reqInStr, reqOutStr, b.checkInDate, b.checkOutDate)
    );

    // 3. Future advance reservations (from today onward)
    const futureBookings = allRoomBookings
      .filter((b) => b.checkInDate >= todayStr)
      .sort((a, b) => a.checkInDate.localeCompare(b.checkInDate));

    const isMaintenance = (r.status as any) === 'MAINTENANCE' || (r.status as any) === 'BLOCKED' || (r.status as any) === 'OUT_OF_ORDER';
    const isCleaning = r.status === 'CLEANING';

    // A room is available for the requested dates if:
    // - It is not under maintenance/blocked
    // - It has ZERO overlapping bookings for the requested stay period [reqInStr, reqOutStr)
    const isAvailableForDates = !isMaintenance && overlappingBookings.length === 0;

    let dateStatus = 'AVAILABLE';
    let overlapReason = '';
    if (isMaintenance) {
      dateStatus = r.status;
    } else if (overlappingBookings.length > 0) {
      const firstOverlap = overlappingBookings[0];
      dateStatus = firstOverlap.status === 'CHECKED_IN' ? 'OCCUPIED' : 'RESERVED';
      overlapReason = `Reserved from ${formatShortDate(firstOverlap.checkInDate)} to ${formatShortDate(firstOverlap.checkOutDate)} (${firstOverlap.guestName})`;
    }

    let advanceBookingSummary = '';
    if (futureBookings.length > 0) {
      advanceBookingSummary = `Reserved from ${formatShortDate(futureBookings[0].checkInDate)} to ${formatShortDate(futureBookings[0].checkOutDate)}`;
    }

    const statusToday = isMaintenance ? r.status : isCleaning ? 'CLEANING' : todayBooking ? 'OCCUPIED' : 'AVAILABLE';

    return {
      ...rObj,
      // Dynamic status for requested stay dates
      isAvailable: isAvailableForDates,
      isAvailableForDates,
      dateStatus,
      overlapReason,
      // Status for today's physical room view
      statusToday,
      status: isAvailableForDates ? 'AVAILABLE' : dateStatus,
      actualDbStatus: r.status,
      guestName: todayBooking ? todayBooking.guestName : (overlappingBookings[0]?.guestName || ''),
      // Advance reservations info
      advanceBookingSummary,
      futureBookings,
      requestedStayPeriod: {
        checkInDate: reqInStr,
        checkOutDate: reqOutStr,
      },
    };
  });

  return enrichedRooms;
};

// @desc    Search Available Rooms by Dates & Type
// @route   GET /api/v1/receptionist/rooms/available
export const getAvailableRooms = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const enrichedRooms = await fetchAvailableRoomsData(req.hotelId, req.query);
    res.status(200).json({ success: true, count: enrichedRooms.length, data: enrichedRooms });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get Combined Booking Room Options (Room Types + Available Rooms)
// @route   GET /api/v1/receptionist/booking/room-options
export const getBookingRoomOptions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const [roomTypes, availableRooms] = await Promise.all([
      RoomType.find({ hotel: req.hotelId, isDeleted: { $ne: true }, isActive: true }).sort({ createdAt: -1 }),
      fetchAvailableRoomsData(req.hotelId, req.query),
    ]);

    res.status(200).json({
      success: true,
      data: {
        roomTypes,
        availableRooms,
        rooms: availableRooms,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const normalizeIdType = (type?: string): 'AADHAAR' | 'PASSPORT' | 'DRIVING_LICENSE' | 'VOTER_ID' | 'PAN' | 'OTHER' => {
  if (!type) return 'AADHAAR';
  const upper = String(type).toUpperCase().replace(/[\s-_]+/g, '_');
  if (upper.includes('AADHAAR') || upper.includes('UIDAI')) return 'AADHAAR';
  if (upper.includes('PASSPORT')) return 'PASSPORT';
  if (upper.includes('DRIV') || upper.includes('LICENSE')) return 'DRIVING_LICENSE';
  if (upper.includes('VOTER')) return 'VOTER_ID';
  if (upper.includes('PAN')) return 'PAN';
  return 'OTHER';
};

export const normalizePaymentMethod = (pm?: string): 'CASH' | 'ONLINE' | 'CARD' | 'UPI' | 'BANK_TRANSFER' => {
  if (!pm) return 'CASH';
  const upper = String(pm).toUpperCase().replace(/[\s-_]+/g, '_');
  if (upper.includes('CARD') || upper.includes('POS') || upper.includes('CREDIT') || upper.includes('DEBIT')) return 'CARD';
  if (upper.includes('UPI') || upper.includes('QR') || upper.includes('GPAY') || upper.includes('PHONEPE') || upper.includes('PAYTM')) return 'UPI';
  if (upper.includes('BANK') || upper.includes('NEFT') || upper.includes('IMPS') || upper.includes('RTGS') || upper.includes('TRANSFER')) return 'BANK_TRANSFER';
  if (upper.includes('ONLINE') || upper.includes('GATEWAY') || upper.includes('RAZORPAY')) return 'ONLINE';
  return 'CASH';
};

// @desc    Register or Update Guest with ID Proof Verification
// @route   POST /api/v1/receptionist/guests
export const registerGuest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      fullName,
      name,
      mobileNumber,
      phone,
      email,
      gender,
      dateOfBirth,
      nationality,
      address,
      city,
      state,
      country,
      emergencyContact,
      idType,
      govtIdType,
      idNumber,
      govtIdNumber,
      frontImage,
      backImage,
      checkInDate,
      checkOutDate,
      status: stayStatus,
      roomAssigned,
      roomNumber,
    } = req.body;

    const guestFullName = (fullName || name || '').trim();
    const guestMobile = (mobileNumber || phone || '').trim();
    const guestIdNum = (idNumber || govtIdNumber || 'PENDING').trim();
    const cleanIdType = normalizeIdType(idType || govtIdType);

    const checkIn = checkInDate ? new Date(checkInDate) : new Date();
    const checkOut = checkOutDate ? new Date(checkOutDate) : new Date(Date.now() + 24 * 60 * 60 * 1000);
    const combinedRoomNumbers = (roomAssigned || roomNumber || '').toString().trim();

    if (!guestFullName || !guestMobile) {
      res.status(400).json({
        success: false,
        message: 'Guest full name and mobile number are required.',
      });
      return;
    }

    // Upload main guest ID images to Cloudinary if Base64
    let cloudFrontImage = frontImage || '';
    let cloudBackImage = backImage || '';
    if (cloudFrontImage && cloudFrontImage.startsWith('data:image')) {
      cloudFrontImage = await uploadToCloudinary(cloudFrontImage, 'hotel_guest_documents/main');
    }
    if (cloudBackImage && cloudBackImage.startsWith('data:image')) {
      cloudBackImage = await uploadToCloudinary(cloudBackImage, 'hotel_guest_documents/main');
    }

    let guest = await Guest.findOne({ hotel: req.hotelId, mobileNumber: guestMobile });

    if (email) {
      const isEmailUsed = await checkEmailExistsGlobally(email, guest ? guest._id.toString() : undefined, 'Guest');
      if (isEmailUsed) {
        res.status(400).json({ success: false, message: 'This email is already registered in the system (either as a user, guest, or another hotel owner).' });
        return;
      }
    }

    if (guest) {
      // Update existing guest details and reactivate if soft-deleted
      guest.fullName = guestFullName;
      if (email !== undefined) guest.email = email;
      if (address !== undefined) guest.address = address;
      if (city !== undefined) guest.city = city;
      if (state !== undefined) guest.state = state;
      guest.isDeleted = false;
      guest.idProof = {
        idType: cleanIdType,
        idNumber: guestIdNum || guest.idProof?.idNumber || 'PENDING',
        frontImage: cloudFrontImage || guest.idProof?.frontImage || '',
        backImage: cloudBackImage || guest.idProof?.backImage || '',
        verificationStatus: guest.idProof?.verificationStatus || 'PENDING',
      };
      await guest.save();
    } else {
      guest = await Guest.create({
        hotel: req.hotelId,
        fullName: guestFullName,
        mobileNumber: guestMobile,
        email: email || '',
        gender: gender || 'Male',
        dateOfBirth,
        nationality: nationality || 'Indian',
        address: address || '',
        city: city || '',
        state: state || '',
        country: country || 'India',
        emergencyContact: emergencyContact || '',
        idProof: {
          idType: cleanIdType,
          idNumber: guestIdNum,
          frontImage: cloudFrontImage || '',
          backImage: cloudBackImage || '',
          verificationStatus: 'PENDING',
        },
        isDeleted: false,
      });
    }

    // Multi-room support: Link or allocate room stay details when provided from Hotel Admin or Front Desk
    const rawRoomIds = Array.isArray(req.body.roomIds) && req.body.roomIds.length > 0
      ? req.body.roomIds
      : Array.isArray(req.body.selectedRooms) && req.body.selectedRooms.length > 0
      ? req.body.selectedRooms.map((r: any) => (typeof r === 'object' ? r._id : r))
      : [];

    let allocatedRooms: any[] = [];
    if (rawRoomIds.length > 0) {
      allocatedRooms = await Room.find({ _id: { $in: rawRoomIds }, hotel: req.hotelId }).populate('roomType');
    } else {
      const assignedRoomNum = (req.body.roomAssigned || req.body.roomNumber || '').toString().trim();
      if (assignedRoomNum && assignedRoomNum !== 'Not Assigned' && assignedRoomNum !== 'N/A') {
        const roomNumList = assignedRoomNum.split(',').map((s: string) => s.trim()).filter(Boolean);
        allocatedRooms = await Room.find({ hotel: req.hotelId, roomNumber: { $in: roomNumList }, isDeleted: { $ne: true } }).populate('roomType');
      }
    }

    if (allocatedRooms.length > 0) {
      const primaryRoom = allocatedRooms[0];
      const roomIdsList = allocatedRooms.map((r: any) => r._id);
      const roomNumbersList = allocatedRooms.map((r: any) => String(r.roomNumber));
      const inStr = toISODateString(checkIn);
      const outStr = toISODateString(checkOut);
      const [y1, m1, d1] = inStr.split('-').map(Number);
      const [y2, m2, d2] = outStr.split('-').map(Number);
      const nights = Math.max(1, Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / (1000 * 60 * 60 * 24)));
      let autoTotalTariff = 0;
      allocatedRooms.forEach((r: any) => {
        autoTotalTariff += (r.customPricePerNight || (r.roomType as any)?.basePrice || 4000) * nights;
      });
      const totalAmt = Number(req.body.totalAmount) > 0 ? Number(req.body.totalAmount) : autoTotalTariff;

      let bookingStatus: 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' = 'CHECKED_IN';
      if (stayStatus === 'RESERVED') bookingStatus = 'CONFIRMED';
      else if (stayStatus === 'CHECKED_OUT' || stayStatus === 'CHECKED-OUT') bookingStatus = 'CHECKED_OUT';

      let booking = await Booking.findOne({
        hotel: req.hotelId,
        guest: guest._id,
        status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
        isDeleted: { $ne: true },
      });

      // Strict date overlap guard
      if (bookingStatus !== 'CHECKED_OUT') {
        const inStr = toISODateString(checkIn);
        const outStr = toISODateString(checkOut);
        for (const room of allocatedRooms) {
          const overlapping = await findOverlappingBookings({
            hotelId: req.hotelId,
            roomIds: [room._id],
            checkInDate: inStr,
            checkOutDate: outStr,
            excludeBookingId: booking?._id,
          });
          if (overlapping.length > 0) {
            const conflict = overlapping[0];
            res.status(400).json({
              success: false,
              message: `⚠️ Room ${room.roomNumber} is already booked from ${formatShortDate(conflict.checkInDate)} to ${formatShortDate(conflict.checkOutDate)} (Booking #${conflict.bookingNumber}).`,
            });
            return;
          }
        }
      }

      if (booking) {
        booking.room = primaryRoom._id as any;
        booking.rooms = roomIdsList as any;
        booking.roomNumber = combinedRoomNumbers;
        booking.roomNumbers = roomNumbersList;
        booking.roomType = (primaryRoom.roomType as any)?._id || primaryRoom.roomType;
        booking.checkInDate = checkIn;
        booking.checkOutDate = checkOut;
        booking.numberOfNights = nights;
        booking.totalAmount = totalAmt;
        booking.dueAmount = Math.max(0, totalAmt - (booking.paidAmount || 0));
        booking.status = bookingStatus;
        const rawAccompanying = Array.isArray(req.body.accompanyingGuests) ? req.body.accompanyingGuests : [];
        const formattedAccompanying = await Promise.all(
          rawAccompanying.map(async (m: any, idx: number) => {
            let mFront = m.frontImage || '';
            let mBack = m.backImage || '';
            if (mFront && mFront.startsWith('data:image')) {
              mFront = await uploadToCloudinary(mFront, 'hotel_guest_documents/members');
            }
            if (mBack && mBack.startsWith('data:image')) {
              mBack = await uploadToCloudinary(mBack, 'hotel_guest_documents/members');
            }
            return {
              ...m,
              name: (m.name || m.fullName || `Guest #${idx + 2}`).trim(),
              gender: m.gender || 'Male',
              relationship: m.relationship || 'Accompanying Guest',
              frontImage: mFront,
              backImage: mBack,
            };
          })
        );

        if (Array.isArray(req.body.accompanyingGuests)) {
          booking.accompanyingGuests = formattedAccompanying;
        }
        await booking.save();
      } else {
        const rawAccompanying = Array.isArray(req.body.accompanyingGuests) ? req.body.accompanyingGuests : [];
        const formattedAccompanying = await Promise.all(
          rawAccompanying.map(async (m: any, idx: number) => {
            let mFront = m.frontImage || '';
            let mBack = m.backImage || '';
            if (mFront && mFront.startsWith('data:image')) {
              mFront = await uploadToCloudinary(mFront, 'hotel_guest_documents/members');
            }
            if (mBack && mBack.startsWith('data:image')) {
              mBack = await uploadToCloudinary(mBack, 'hotel_guest_documents/members');
            }
            return {
              ...m,
              name: (m.name || m.fullName || `Guest #${idx + 2}`).trim(),
              gender: m.gender || 'Male',
              relationship: m.relationship || 'Accompanying Guest',
              frontImage: mFront,
              backImage: mBack,
            };
          })
        );

        await Booking.create({
          hotel: req.hotelId,
          bookingNumber: `BK-${Date.now().toString().slice(-6)}`,
          guest: guest._id,
          room: primaryRoom._id,
          rooms: roomIdsList,
          roomNumber: combinedRoomNumbers,
          roomNumbers: roomNumbersList,
          roomType: (primaryRoom.roomType as any)?._id || primaryRoom.roomType,
          checkInDate: checkIn,
          checkOutDate: checkOut,
          checkInTime: req.body.checkInTime || req.hotel?.settings?.checkInTime || '14:00',
          checkOutTime: req.body.checkOutTime || req.hotel?.settings?.checkOutTime || '12:00',
          numberOfNights: nights,
          baseAmount: totalAmt,
          totalAmount: totalAmt,
          paidAmount: Number(req.body.advancePaid) || 0,
          dueAmount: Math.max(0, totalAmt - (Number(req.body.advancePaid) || 0)),
          status: bookingStatus,
          source: 'WALK_IN',
          accompanyingGuests: formattedAccompanying,
        });
      }

      for (const r of allocatedRooms) {
        if (bookingStatus === 'CHECKED_IN') {
          r.status = 'OCCUPIED';
          await r.save();
          emitToHotel(req.hotelId, 'ROOM_UPDATED', {
            roomId: r._id,
            roomNumber: r.roomNumber,
            status: 'OCCUPIED',
            guestName: guest.fullName,
          });
        }
      }
    }

    emitToHotel(req.hotelId, 'GUEST_UPDATED', { guestId: guest._id, fullName: guest.fullName });
    emitToHotel(req.hotelId, 'DASHBOARD_SYNC', { type: 'GUEST_SAVED' });
    res.status(200).json({ success: true, message: 'Guest details saved successfully.', data: guest });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Verify Guest ID Proof (Front-Desk Staff Action)
// @route   PUT /api/v1/receptionist/guests/:id/verify-id
export const verifyGuestId = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { status = 'VERIFIED', verificationNotes } = req.body;
    const guest = await Guest.findOne({ _id: req.params.id, hotel: req.hotelId });
    if (!guest) {
      res.status(404).json({ success: false, message: 'Guest not found.' });
      return;
    }

    guest.idProof.verificationStatus = status;
    guest.idProof.verifiedBy = req.user?._id as any;
    guest.idProof.verifiedAt = new Date();
    guest.idProof.verificationNotes = verificationNotes || 'Verified physically at front desk.';
    await guest.save();

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: `GUEST_ID_${status}`,
        module: 'GUESTS',
        entityId: guest.fullName,
      });
    }

    emitToHotel(req.hotelId, 'GUEST_UPDATED', { guestId: guest._id, fullName: guest.fullName, status });
    res.status(200).json({ success: true, message: `Guest ID verification marked as ${status}.`, data: guest });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create Booking or Instant Walk-in Check-In
// @route   POST /api/v1/receptionist/bookings
export const createBookingOrCheckIn = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      guestId,
      guest: guestPayload,
      fullName,
      mobileNumber,
      mobile,
      email,
      address,
      city,
      state,
      country,
      nationality,
      gender,
      dateOfBirth,
      dob,
      govtIdType,
      idType,
      govtIdNumber,
      idNumber,
      roomId,
      roomNumber,
      checkInDate,
      checkOutDate,
      checkInTime,
      checkOutTime,
      adults = 1,
      children = 0,
      accompanyingGuests = [],
      members = [],
      isInstantCheckIn = true,
      advancePaymentAmount = 0,
      paymentMethod = 'CASH',
      discountAmount = 0,
      securityDepositAmount = 0,
      securityDeposit = 0,
      specialRequests,
    } = req.body;

    const depositAmt = Number(securityDepositAmount || securityDeposit || 0);

    const guestName = fullName || guestPayload?.fullName || guestPayload?.name;
    const guestPhone = mobileNumber || mobile || guestPayload?.mobileNumber || guestPayload?.phone;
    const guestEmail = email || guestPayload?.email || '';
    const guestIdType = govtIdType || idType || guestPayload?.govtIdType || guestPayload?.idType || 'AADHAAR';
    const guestIdNum = govtIdNumber || idNumber || guestPayload?.govtIdNumber || guestPayload?.idNumber || 'PENDING';

    const guestAddress = address || guestPayload?.address || '';
    const guestCity = city || guestPayload?.city || '';
    const guestState = state || guestPayload?.state || '';
    const guestCountry = country || guestPayload?.country || 'India';
    const guestNationality = nationality || guestPayload?.nationality || 'Indian';
    const guestGender = gender || guestPayload?.gender || 'Male';
    const guestDob = dateOfBirth || dob || guestPayload?.dateOfBirth;

    const cleanGuestIdType = normalizeIdType(guestIdType);
    const reusePreviousId = req.body.reusePreviousId === true || req.body.reusePreviousId === 'true';

    // Cloudinary ID Proofs upload for Main Guest
    let uploadedFrontImage = req.body.frontImage || '';
    let uploadedBackImage = req.body.backImage || '';
    if (uploadedFrontImage && uploadedFrontImage.startsWith('data:image')) {
      uploadedFrontImage = await uploadToCloudinary(uploadedFrontImage, 'hotel_guest_documents/main');
    }
    if (uploadedBackImage && uploadedBackImage.startsWith('data:image')) {
      uploadedBackImage = await uploadToCloudinary(uploadedBackImage, 'hotel_guest_documents/main');
    }

    // Parse and upload accompanying members ID photos
    const rawMembers = Array.isArray(accompanyingGuests) && accompanyingGuests.length > 0 
      ? accompanyingGuests 
      : Array.isArray(members) ? members : [];
    const sanitizedMembers = await Promise.all(
      rawMembers.map(async (m: any, index: number) => {
        let memberFront = m.frontImage || m.idProofImage || '';
        let memberBack = m.backImage || '';
        if (memberFront && memberFront.startsWith('data:image')) {
          memberFront = await uploadToCloudinary(memberFront, 'hotel_guest_documents/members');
        }
        if (memberBack && memberBack.startsWith('data:image')) {
          memberBack = await uploadToCloudinary(memberBack, 'hotel_guest_documents/members');
        }
        return {
          name: (m.name || m.fullName || `Guest #${index + 2}`).trim(),
          age: m.age ? Number(m.age) : undefined,
          gender: m.gender || 'Male',
          relationship: m.relationship || 'Accompanying Guest',
          email: (m.email || '').trim().toLowerCase(),
          mobileNumber: (m.mobileNumber || m.phone || '').trim(),
          phone: (m.mobileNumber || m.phone || '').trim(),
          idType: normalizeIdType(m.idType || m.govtIdType || 'AADHAAR'),
          idNumber: (m.idNumber || m.govtIdNumber || '').trim(),
          frontImage: memberFront,
          backImage: memberBack,
        };
      })
    );
    const filteredMembers = sanitizedMembers.filter((m: any) => m.frontImage || m.backImage || (m.name && m.name.length > 0));

    let guest: any = null;
    let isReturningGuest = false;

    if (guestId && mongoose.isValidObjectId(guestId)) {
      guest = await Guest.findOne({ _id: guestId, hotel: req.hotelId });
    }
    if (!guest && guestPhone) {
      guest = await Guest.findOne({ hotel: req.hotelId, mobileNumber: guestPhone });
    }
    if (!guest && guestEmail) {
      guest = await Guest.findOne({ hotel: req.hotelId, email: guestEmail.toLowerCase().trim() });
    }

    if (guest) {
      isReturningGuest = true;
      guest.totalVisits = (guest.totalVisits || 1) + 1;
      guest.isDeleted = false;
      if (guestName && guestName !== 'Walk-in Guest') guest.fullName = guestName;
      if (guestEmail) guest.email = guestEmail;
      if (guestAddress) guest.address = guestAddress;
      if (guestCity) guest.city = guestCity;
      if (guestState) guest.state = guestState;
      if (guestCountry) guest.country = guestCountry;
      if (guestNationality) guest.nationality = guestNationality;
      if (guestGender) guest.gender = guestGender;
      if (guestDob) guest.dateOfBirth = guestDob;

      if (!guest.idProof) {
        guest.idProof = {
          idType: cleanGuestIdType,
          idNumber: guestIdNum || 'PENDING',
          frontImage: uploadedFrontImage || '',
          backImage: uploadedBackImage || '',
          verificationStatus: guestIdNum && guestIdNum !== 'PENDING' ? 'VERIFIED' : 'PENDING',
        };
      } else {
        if (cleanGuestIdType) guest.idProof.idType = cleanGuestIdType;
        if (guestIdNum && guestIdNum !== 'PENDING') guest.idProof.idNumber = guestIdNum;
        if (uploadedFrontImage) guest.idProof.frontImage = uploadedFrontImage;
        if (uploadedBackImage) guest.idProof.backImage = uploadedBackImage;
        if (guestIdNum && guestIdNum !== 'PENDING') guest.idProof.verificationStatus = 'VERIFIED';
      }
      await guest.save();
    } else {
      guest = await Guest.create({
        hotel: req.hotelId,
        fullName: guestName || 'Walk-in Guest',
        mobileNumber: guestPhone || `999${Date.now().toString().slice(-7)}`,
        email: guestEmail || '',
        gender: guestGender,
        dateOfBirth: guestDob,
        nationality: guestNationality,
        address: guestAddress,
        city: guestCity,
        state: guestState,
        country: guestCountry,
        idProof: {
          idType: cleanGuestIdType,
          idNumber: guestIdNum,
          frontImage: uploadedFrontImage || '',
          backImage: uploadedBackImage || '',
          verificationStatus: guestIdNum && guestIdNum !== 'PENDING' ? 'VERIFIED' : 'PENDING',
          verifiedBy: req.user?._id as any,
          verifiedAt: new Date(),
        },
        totalVisits: 1,
        totalSpent: 0,
        isDeleted: false,
      });
    }

    if (!guest) {
      res.status(400).json({
        success: false,
        message: 'Guest identification (guestId or guest name + mobile number) is required.',
      });
      return;
    }

    // Support multi-room booking allocation
    const rawRoomIds = Array.isArray(req.body.roomIds) && req.body.roomIds.length > 0 
      ? req.body.roomIds 
      : Array.isArray(req.body.selectedRooms) && req.body.selectedRooms.length > 0
      ? req.body.selectedRooms
      : roomId ? [roomId] : [];

    const sanitizedRoomIds = rawRoomIds
      .map((r: any) => (typeof r === 'object' && r !== null ? String(r._id || r.id) : String(r)))
      .filter((id: any) => id && id !== 'undefined' && id !== 'null' && mongoose.isValidObjectId(id));

    let allocatedRooms: any[] = [];
    if (sanitizedRoomIds.length > 0) {
      allocatedRooms = await Room.find({ _id: { $in: sanitizedRoomIds }, hotel: req.hotelId }).populate('roomType');
    }
    
    if (allocatedRooms.length === 0 && roomNumber) {
      const roomNumList = Array.isArray(roomNumber) 
        ? roomNumber 
        : String(roomNumber).split(',').map((s: string) => s.trim());
      allocatedRooms = await Room.find({ hotel: req.hotelId, roomNumber: { $in: roomNumList } }).populate('roomType');
    }

    if (allocatedRooms.length === 0) {
      const defaultRoom = await Room.findOne({ hotel: req.hotelId, status: 'AVAILABLE', isActive: true, isDeleted: { $ne: true } }).populate('roomType') 
        || await Room.findOne({ hotel: req.hotelId, isActive: true, isDeleted: { $ne: true } }).populate('roomType');
      if (defaultRoom) {
        allocatedRooms = [defaultRoom];
      }
    }

    if (allocatedRooms.length === 0) {
      res.status(404).json({ success: false, message: 'No valid room found for allocation. Please create rooms first.' });
      return;
    }

    // Format & Calculate Check-in and Check-out Date/Time
    const nowTimeStr = new Date().toTimeString().slice(0, 5);
    const inTimeStr = checkInTime || nowTimeStr || req.hotel?.settings?.checkInTime || '14:00';
    const outTimeStr = checkOutTime || req.hotel?.settings?.checkOutTime || '12:00';

    const cInDate = checkInDate ? new Date(checkInDate) : new Date();
    const [inHours, inMins] = inTimeStr.split(':').map(Number);
    if (!isNaN(inHours) && !isNaN(inMins)) {
      cInDate.setHours(inHours, inMins, 0, 0);
    }

    let cOutDate = checkOutDate ? new Date(checkOutDate) : new Date(cInDate.getTime() + 86400000);
    const [outHours, outMins] = outTimeStr.split(':').map(Number);
    if (!isNaN(outHours) && !isNaN(outMins)) {
      cOutDate.setHours(outHours, outMins, 0, 0);
    } else {
      cOutDate.setHours(12, 0, 0, 0);
    }

    const reqCheckInStr = toISODateString(cInDate);
    let reqCheckOutStr = toISODateString(cOutDate);
    if (!reqCheckOutStr || reqCheckOutStr <= reqCheckInStr) {
      const dIn = new Date(reqCheckInStr);
      dIn.setDate(dIn.getDate() + 1);
      reqCheckOutStr = toISODateString(dIn);
      cOutDate = new Date(dIn);
      if (!isNaN(outHours) && !isNaN(outMins)) {
        cOutDate.setHours(outHours, outMins, 0, 0);
      } else {
        cOutDate.setHours(12, 0, 0, 0);
      }
    }

    // 🚫 ROOM MAINTENANCE GUARD
    const maintenanceRooms = allocatedRooms.filter((r: any) => r.status === 'MAINTENANCE' || r.status === 'BLOCKED' || r.status === 'OUT_OF_ORDER');
    if (maintenanceRooms.length > 0) {
      res.status(400).json({
        success: false,
        message: `⚠️ Room(s) ${maintenanceRooms.map((r: any) => r.roomNumber).join(', ')} are currently under Maintenance / Blocked. Please select an available room.`,
      });
      return;
    }

    // 🚫 STRICT CONCURRENT BOOKING OVERLAP VALIDATION (Backend Safety Guard)
    // Rule: EXISTING CHECK-IN < REQUESTED CHECK-OUT AND EXISTING CHECK-OUT > REQUESTED CHECK-IN
    for (const room of allocatedRooms) {
      const overlapping = await findOverlappingBookings({
        hotelId: req.hotelId,
        roomIds: [room._id],
        checkInDate: reqCheckInStr,
        checkOutDate: reqCheckOutStr,
      });

      if (overlapping.length > 0) {
        const conflict = overlapping[0];
        const conflictIn = formatShortDate(conflict.checkInDate);
        const conflictOut = formatShortDate(conflict.checkOutDate);
        res.status(400).json({
          success: false,
          message: `⚠️ Room ${room.roomNumber} is no longer available for the selected dates (${formatShortDate(reqCheckInStr)} to ${formatShortDate(reqCheckOutStr)}). It is already booked from ${conflictIn} to ${conflictOut} (Booking #${conflict.bookingNumber}).`,
        });
        return;
      }
    }

    const primaryRoom = allocatedRooms[0];
    const roomIdsList = allocatedRooms.map((r: any) => r._id);
    const roomNumbersList = allocatedRooms.map((r: any) => String(r.roomNumber));
    const combinedRoomNumbers = roomNumbersList.join(', ');

    // Calculate Total Max Capacity across ALL allocated rooms
    const totalRoomCapacity = allocatedRooms.reduce((sum: number, r: any) => {
      const roomTypeObj = typeof r.roomType === 'object' ? r.roomType : null;
      const cap = Number(r.maxCapacity) ||
                  Number(r.capacity?.adults) ||
                  Number(r.seatingCapacity) ||
                  Number(r.maxGuests) ||
                  Number(roomTypeObj?.capacity?.adults) ||
                  Number(roomTypeObj?.maxCapacity) ||
                  2;
      return sum + cap;
    }, 0);

    const totalSubmittedGuests = 1 + filteredMembers.length;
    if (totalRoomCapacity > 0 && totalSubmittedGuests > totalRoomCapacity) {
      res.status(400).json({
        success: false,
        message: `Guest count (${totalSubmittedGuests}) exceeds the maximum capacity (${totalRoomCapacity}) of the selected room(s).`,
      });
      return;
    }

    const todayStr = toISODateString(new Date());
    const isCheckInForTodayOrPast = reqCheckInStr <= todayStr;
    const shouldInstantCheckIn = Boolean(isInstantCheckIn) && isCheckInForTodayOrPast;

    // If attempting instant check-in today, ensure room is not currently occupied right now
    if (shouldInstantCheckIn) {
      const occupiedRooms = allocatedRooms.filter((r: any) => r.status === 'OCCUPIED');
      if (occupiedRooms.length > 0) {
        res.status(400).json({
          success: false,
          message: `⚠️ Room(s) ${occupiedRooms.map((r: any) => r.roomNumber).join(', ')} are currently OCCUPIED by another in-house guest today. Please select an available room.`,
        });
        return;
      }
    }

    // Calculate Nights & Financials across ALL allocated rooms
    const [y1, m1, day1] = reqCheckInStr.split('-').map(Number);
    const [y2, m2, day2] = reqCheckOutStr.split('-').map(Number);
    const calendarNights = Math.max(1, Math.round((Date.UTC(y2, m2 - 1, day2) - Date.UTC(y1, m1 - 1, day1)) / (1000 * 60 * 60 * 24)));
    const numberOfNights = req.body.numberOfNights && Number(req.body.numberOfNights) > 0
      ? Math.max(1, Number(req.body.numberOfNights))
      : calendarNights;

    // Calculate Multi-Room GST Breakdown
    const gstCalc = calculateMultiRoomBookingGST({
      selectedRooms: allocatedRooms.map((r: any) => {
        const rtObj = typeof r.roomType === 'object' ? r.roomType : null;
        const nightlyTariff = Number(r.customPricePerNight) || Number(rtObj?.basePrice) || Number(r.basePrice) || 2500;
        return {
          _id: r._id,
          roomNumber: r.roomNumber,
          roomType: rtObj?.name || 'Room',
          customPricePerNight: r.customPricePerNight,
          basePrice: nightlyTariff,
          gstEnabled: r.gstEnabled !== undefined ? r.gstEnabled : (rtObj?.gstEnabled ?? true),
          gstRate: r.gstRate !== undefined ? r.gstRate : (rtObj?.gstRate ?? 18),
          taxInclusive: r.taxInclusive !== undefined ? r.taxInclusive : (rtObj?.taxInclusive ?? false),
        };
      }),
      nights: numberOfNights,
      discountAmount: Number(discountAmount || 0),
      securityDepositAmount: depositAmt,
      defaultGstRate: req.hotel?.settings?.defaultGstRate || 18,
      defaultTaxInclusive: req.hotel?.settings?.taxInclusive || false,
    });

    const baseAmount = gstCalc.taxableAmount;
    const taxAmount = gstCalc.totalGstAmount;
    const totalAmount = gstCalc.grandTotal;
    // 100% Advance Payment Requirement
    const advancePaid = advancePaymentAmount !== undefined ? Number(advancePaymentAmount) : totalAmount;
    const dueAmount = Math.max(0, totalAmount - advancePaid);

    // Booking Reference Number
    const bookingNumber = `BK-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    const booking = await Booking.create({
      hotel: req.hotelId,
      bookingNumber,
      guest: guest._id,
      room: primaryRoom._id,
      rooms: roomIdsList,
      roomNumber: combinedRoomNumbers,
      roomNumbers: roomNumbersList,
      roomType: primaryRoom.roomType?._id || primaryRoom.roomType,
      createdBy: req.user?._id,
      checkInDate: cInDate,
      checkOutDate: cOutDate,
      checkInTime: inTimeStr,
      checkOutTime: outTimeStr,
      actualCheckIn: shouldInstantCheckIn ? new Date() : undefined,
      numberOfNights,
      guestsCount: { adults: Math.max(1, Number(adults) || (1 + filteredMembers.length)), children: Number(children) || 0 },
      accompanyingGuests: filteredMembers,
      baseAmount,
      taxAmount,
      gstRate: gstCalc.roomBreakdowns[0]?.effGstRate || 18,
      cgstRate: gstCalc.roomBreakdowns[0]?.cgstRate || 9,
      sgstRate: gstCalc.roomBreakdowns[0]?.sgstRate || 9,
      gstAmount: gstCalc.totalGstAmount,
      cgstAmount: gstCalc.cgstAmount,
      sgstAmount: gstCalc.sgstAmount,
      igstAmount: gstCalc.igstAmount,
      taxableAmount: gstCalc.taxableAmount,
      taxInclusive: gstCalc.roomBreakdowns[0]?.taxInclusive || false,
      roomGstBreakdown: gstCalc.roomBreakdowns,
      discountAmount: Number(discountAmount),
      securityDepositAmount: depositAmt,
      extraChargesTotal: 0,
      totalAmount,
      paidAmount: advancePaid,
      dueAmount,
      status: shouldInstantCheckIn ? 'CHECKED_IN' : 'CONFIRMED',
      specialRequests,
    });

    // If checked in, set ALL allocated rooms to OCCUPIED
    if (shouldInstantCheckIn) {
      await Room.updateMany(
        { _id: { $in: roomIdsList }, hotel: req.hotelId },
        { $set: { status: 'OCCUPIED' } }
      );
    }

    // Process Advance Payment if paid > 0
    let receiptNumber = '';
    const cleanPaymentMethod = normalizePaymentMethod(paymentMethod);
    if (advancePaid > 0) {
      receiptNumber = `RCP-${Date.now().toString().slice(-6)}`;
      await Payment.create({
        hotel: req.hotelId,
        booking: booking._id,
        guest: guest._id,
        collectedBy: req.user?._id,
        receiptNumber,
        amount: advancePaid,
        paymentMethod: cleanPaymentMethod,
        paymentType: dueAmount === 0 ? 'FULL_SETTLEMENT' : 'ADVANCE',
        paymentStatus: 'PAID',
        transactionId: req.body.transactionId || req.body.utrNumber || req.body.authCode || '',
        paymentReference: req.body.paymentReference || req.body.cardLast4 || req.body.bankName || '',
        note: req.body.paymentNote || `Advance settled via ${cleanPaymentMethod} at check-in`,
      });
    }

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: shouldInstantCheckIn ? 'GUEST_CHECKED_IN' : 'BOOKING_CREATED',
        module: 'BOOKINGS',
        entityId: booking.bookingNumber,
        newValue: { guest: guest.fullName, room: combinedRoomNumbers, totalAmount, paid: advancePaid },
      });
    }

    // Real-Time Multi-Tenant Socket Broadcasts
    emitToHotel(req.hotelId, 'BOOKING_CREATED', {
      bookingId: booking._id,
      bookingNumber: booking.bookingNumber,
      guestName: guest.fullName,
      roomNumber: combinedRoomNumbers,
      status: booking.status,
      totalAmount,
      paidAmount: advancePaid,
    });
    allocatedRooms.forEach((r: any) => {
      emitToHotel(req.hotelId, 'ROOM_UPDATED', {
        roomId: r._id,
        roomNumber: r.roomNumber,
        status: shouldInstantCheckIn ? 'OCCUPIED' : r.status,
        guestName: shouldInstantCheckIn ? guest.fullName : undefined,
      });
    });
    emitToHotel(req.hotelId, 'DASHBOARD_SYNC', { type: shouldInstantCheckIn ? 'CHECK_IN' : 'NEW_BOOKING' });
    if (advancePaid > 0) {
      emitToHotel(req.hotelId, 'PAYMENT_RECORDED', {
        receiptNumber,
        amount: advancePaid,
        method: cleanPaymentMethod,
        bookingNumber: booking.bookingNumber,
      });
    }

    // 📧 Asynchronous Welcome & Booking Confirmation Email to Main Guest
    const recipientGuestEmail = guest.email || guestEmail;
    if (recipientGuestEmail && recipientGuestEmail.includes('@')) {
      const amenitiesSet = new Set<string>();
      allocatedRooms.forEach((r: any) => {
        if (Array.isArray(r.amenities)) r.amenities.forEach((a: string) => a && amenitiesSet.add(a));
        if (r.roomType && Array.isArray(r.roomType.amenities)) r.roomType.amenities.forEach((a: string) => a && amenitiesSet.add(a));
      });
      if (req.hotel && Array.isArray((req.hotel as any).amenities)) {
        (req.hotel as any).amenities.forEach((a: string) => a && amenitiesSet.add(a));
      }
      if (req.hotel?.settings && Array.isArray(req.hotel.settings.amenities)) {
        req.hotel.settings.amenities.forEach((a: string) => a && amenitiesSet.add(a));
      }

      const policiesList = Array.isArray(req.hotel?.settings?.policies) && req.hotel?.settings?.policies.length > 0
        ? req.hotel?.settings?.policies
        : [
            'Standard Check-Out is strictly 12:00 PM (Noon).',
            'Government photo ID is required for all staying guests.',
            'All indoor rooms and corridors are 100% smoke-free zones.',
            'Quiet hours are observed between 10:00 PM and 07:00 AM.',
            'Please keep valuables in the in-room safe.',
            'Dial 0 from room intercom for 24/7 Front Desk assistance.',
          ];

      sendEmail({
        email: recipientGuestEmail,
        subject: `🏨 Stay Confirmation & Pass - Room #${combinedRoomNumbers} at ${req.hotel?.name || 'The Hotel'}`,
        html: guestBookingConfirmationTemplate({
          hotelName: req.hotel?.name || 'The Grand Royale Hotel',
          hotelAddress: req.hotel?.address || '',
          hotelPhone: req.hotel?.ownerPhone || '',
          hotelEmail: req.hotel?.ownerEmail || '',
          guestName: guest.fullName,
          guestEmail: recipientGuestEmail,
          guestPhone: guest.mobileNumber || '',
          bookingNumber: booking.bookingNumber,
          roomNumbers: combinedRoomNumbers,
          roomCategory: primaryRoom.roomType?.name || primaryRoom.category || 'Standard Room',
          bedType: primaryRoom.bedType || primaryRoom.roomType?.bedType || '1 King Bed',
          checkInDate: cInDate.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
          checkInTime: inTimeStr,
          checkOutDate: cOutDate.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
          checkOutTime: outTimeStr,
          numberOfNights,
          totalGuests: Math.max(1, Number(adults) || 1) + Number(children || 0) + filteredMembers.length,
          adults: Math.max(1, Number(adults) || 1),
          children: Number(children) || 0,
          accompanyingMembers: filteredMembers.map((m: any) => m.name),
          totalAmount,
          paidAmount: advancePaid,
          dueAmount,
          securityDeposit: depositAmt,
          paymentMethod: cleanPaymentMethod,
          amenities: Array.from(amenitiesSet),
          rulesAndInstructions: policiesList,
          specialRequests: specialRequests || '',
        }),
      }).catch((emailErr: any) => {
        console.warn('⚠️ [sendEmail] Failed to send guest booking confirmation email:', emailErr.message);
      });
    }

    res.status(201).json({
      success: true,
      message: isInstantCheckIn
        ? `Guest ${guest.fullName} checked in to Room ${combinedRoomNumbers} successfully!`
        : `Reservation ${bookingNumber} created successfully!`,
      data: {
        booking,
        receiptNumber,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Add Extra Charges (Room Service, Laundry, Mini-bar, Damage)
// @route   POST /api/v1/receptionist/bookings/:id/charges
export const addBookingCharge = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { type, title, item, amount, quantity = 1, notes } = req.body;
    const chargeTitle = title || item;
    if (!chargeTitle || !amount) {
      res.status(400).json({ success: false, message: 'Charge title and amount are required.' });
      return;
    }

    const booking = await Booking.findOne({ _id: req.params.id, hotel: req.hotelId });
    if (!booking) {
      res.status(404).json({ success: false, message: 'Booking not found.' });
      return;
    }

    const totalCharge = Number(amount) * Number(quantity);

    const charge = await BookingCharge.create({
      hotel: req.hotelId,
      booking: booking._id,
      guest: booking.guest,
      createdBy: req.user?._id,
      type: type || 'ROOM_SERVICE',
      title: chargeTitle,
      amount: Number(amount),
      quantity: Number(quantity),
      totalAmount: totalCharge,
      notes,
    });

    // Update Booking Totals
    booking.extraChargesTotal += totalCharge;
    booking.totalAmount += totalCharge;
    booking.dueAmount += totalCharge;
    await booking.save();

    emitToHotel(req.hotelId, 'BOOKING_UPDATED', {
      bookingId: booking._id,
      bookingNumber: booking.bookingNumber,
      newTotal: booking.totalAmount,
      newDue: booking.dueAmount,
    });
    emitToHotel(req.hotelId, 'DASHBOARD_SYNC', { type: 'CHARGE_ADDED' });

    res.status(201).json({
      success: true,
      message: `Added ₹${totalCharge} for ${chargeTitle} to booking bill.`,
      data: { charge, newTotal: booking.totalAmount, newDue: booking.dueAmount },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Process Final Check-Out, Collect Remaining Dues & Set Room to CLEANING
// @route   POST /api/v1/receptionist/bookings/:id/check-out
export const processCheckOut = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      settlementPaymentAmount = 0,
      lateCheckoutFee = 0,
      lateCheckoutType = 'none',
      lateCheckoutHours = 0,
      lateCheckoutMinutes = 0,
      hourlyRate = 0,
      dailyRoomRate = 0,
      gracePeriodMinutes = 10,
      paymentMethod = 'CASH',
    } = req.body;

    const booking = await Booking.findOne({ _id: req.params.id, hotel: req.hotelId })
      .populate('guest')
      .populate('room');

    if (!booking) {
      res.status(404).json({ success: false, message: 'Booking not found.' });
      return;
    }

    if (booking.status === 'CHECKED_OUT') {
      res.status(400).json({ success: false, message: 'Booking has already been checked out.' });
      return;
    }

    const lateFee = Number(lateCheckoutFee) || 0;
    if (lateFee > 0) {
      booking.lateCheckoutCharge = lateFee;
      booking.lateCheckoutHours = Number(lateCheckoutHours) || 0;
      booking.lateCheckoutMinutes = Number(lateCheckoutMinutes) || 0;
      booking.lateCheckoutType = (lateCheckoutType as any) || 'hourly';
      booking.hourlyRate = Number(hourlyRate) || 0;
      booking.dailyRoomRate = Number(dailyRoomRate) || 0;
      booking.gracePeriodMinutes = Number(gracePeriodMinutes) || 10;
      booking.extraChargesTotal = (booking.extraChargesTotal || 0) + lateFee;
      booking.totalAmount += lateFee;
    }

    const paidNow = Number(settlementPaymentAmount) || 0;
    booking.paidAmount += paidNow;
    booking.dueAmount = Math.max(0, booking.totalAmount - booking.paidAmount);
    booking.status = 'CHECKED_OUT';
    const actualNow = new Date();
    booking.actualCheckOut = actualNow;
    booking.checkOutDate = actualNow;
    booking.checkOutTime = `${String(actualNow.getHours()).padStart(2, '0')}:${String(actualNow.getMinutes()).padStart(2, '0')}`;
    await booking.save();

    // Mark All Allocated Rooms for CLEANING with 15-minute housekeeping turnaround timer
    const roomsToClean = booking.rooms && booking.rooms.length > 0 ? booking.rooms : [booking.room];
    await Room.updateMany(
      { _id: { $in: roomsToClean } },
      {
        $set: {
          status: 'CLEANING',
          cleaningStartedAt: new Date(),
          cleaningDurationMinutes: 15,
        },
      }
    );

    // Receipt generation if paid
    let receiptNumber = '';
    const cleanPaymentMethod = normalizePaymentMethod(paymentMethod);
    if (paidNow > 0) {
      receiptNumber = `RCP-${Date.now().toString().slice(-6)}`;
      await Payment.create({
        hotel: req.hotelId,
        booking: booking._id,
        guest: booking.guest,
        collectedBy: req.user?._id,
        receiptNumber,
        amount: paidNow,
        paymentMethod: cleanPaymentMethod,
        paymentType: 'FULL_SETTLEMENT',
        paymentStatus: 'PAID',
        transactionId: req.body.transactionId || req.body.utrNumber || '',
        paymentReference: req.body.paymentReference || '',
        note: req.body.note || `Checkout settlement via ${cleanPaymentMethod}${lateFee > 0 ? ` (Late checkout +₹${lateFee})` : ''}`,
      });
    }

    const guestObj = booking.guest as any;
    const roomObj = booking.room as any;

    if (guestObj && guestObj.email) {
      try {
        await sendEmail({
          email: guestObj.email,
          subject: `Invoice & Checkout Settlement - ${req.hotel?.name || 'Hotel'}`,
          html: paymentReceiptTemplate({
            hotelName: req.hotel?.name || 'The Hotel',
            hotelAddress: req.hotel?.address || '',
            hotelGst: req.hotel?.gstNumber,
            receiptNumber: receiptNumber || `INV-${booking.bookingNumber}`,
            bookingNumber: booking.bookingNumber,
            guestName: guestObj.fullName || 'Guest',
            roomNumber: roomObj?.roomNumber || '101',
            roomType: 'Room Stay',
            checkIn: new Date(booking.checkInDate).toLocaleDateString('en-IN'),
            checkOut: new Date().toLocaleDateString('en-IN'),
            amount: booking.totalAmount,
            paymentMethod: paymentMethod || 'CASH',
            paymentType: 'Full Checkout Settlement',
            balanceDue: booking.dueAmount,
            collectedByName: req.user?.name || 'Front Desk',
            date: new Date().toLocaleDateString('en-IN'),
          }),
        });
      } catch (err: any) {
        console.warn('Failed to email receipt:', err.message);
      }
    }

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: 'GUEST_CHECKED_OUT',
        module: 'BOOKINGS',
        entityId: booking.bookingNumber,
        newValue: { totalAmount: booking.totalAmount, roomStatus: 'CLEANING' },
      });
    }

    // Real-Time Multi-Tenant Socket Broadcasts
    emitToHotel(req.hotelId, 'GUEST_CHECKED_OUT', {
      bookingNumber: booking.bookingNumber,
      roomNumber: roomObj?.roomNumber,
      guestName: guestObj?.fullName,
    });
    emitToHotel(req.hotelId, 'ROOM_UPDATED', {
      roomId: booking.room,
      roomNumber: roomObj?.roomNumber,
      status: 'CLEANING',
    });
    emitToHotel(req.hotelId, 'DASHBOARD_SYNC', { type: 'CHECK_OUT' });
    if (paidNow > 0) {
      emitToHotel(req.hotelId, 'PAYMENT_RECORDED', {
        receiptNumber,
        amount: paidNow,
        method: cleanPaymentMethod,
        bookingNumber: booking.bookingNumber,
      });
    }

    res.status(200).json({
      success: true,
      message: `Checkout complete for ${guestObj?.fullName || 'Guest'}. Room is now marked for CLEANING.`,
      data: {
        bookingNumber: booking.bookingNumber,
        totalAmount: booking.totalAmount,
        totalPaid: booking.paidAmount,
        dueRemaining: booking.dueAmount,
        roomStatus: 'CLEANING',
        receiptNumber,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get All Guests for this Hotel
// @route   GET /api/v1/receptionist/guests
export const getGuestsList = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { search, page, limit } = req.query;
    const query: any = { hotel: req.hotelId, isDeleted: { $ne: true } };

    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { mobileNumber: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const guests = await Guest.find(query).sort({ createdAt: -1 });

    // Fetch all bookings for this hotel to link real-time stay status, room assignment, and visits
    const allBookings = await Booking.find({ hotel: req.hotelId, isDeleted: { $ne: true } })
      .populate('room', 'roomNumber floor status customPricePerNight')
      .populate('rooms', 'roomNumber floor status customPricePerNight')
      .populate('roomType', 'name')
      .sort({ createdAt: -1 });

    const bookingsByGuest: { [key: string]: any[] } = {};
    allBookings.forEach((b) => {
      const gId = b.guest?.toString();
      if (gId) {
        if (!bookingsByGuest[gId]) bookingsByGuest[gId] = [];
        bookingsByGuest[gId].push(b);
      }
    });

    const formattedGuests = guests.map((g) => {
      const gObj = g.toObject();
      const guestBookings = bookingsByGuest[g._id.toString()] || [];

      // Prioritize active in-house stay, then confirmed reservation, else recent stay
      const activeBooking =
        guestBookings.find((b) => b.status === 'CHECKED_IN') ||
        guestBookings.find((b) => b.status === 'CONFIRMED') ||
        guestBookings[0];

      let stayStatus = 'REGISTERED';
      let roomNumber = 'Not Assigned';
      let checkInStr = 'N/A';
      let checkOutStr = 'N/A';
      let roomIds: any[] = [];
      let roomNumsList: string[] = [];

      if (activeBooking) {
        if (activeBooking.status === 'CHECKED_IN') stayStatus = 'IN-HOUSE';
        else if (activeBooking.status === 'CONFIRMED') stayStatus = 'RESERVED';
        else if (activeBooking.status === 'CHECKED_OUT') stayStatus = 'CHECKED_OUT';
        else if (activeBooking.status === 'CANCELLED') stayStatus = 'CANCELLED';

        const rList = Array.isArray(activeBooking.rooms) && activeBooking.rooms.length > 0
          ? activeBooking.rooms
          : activeBooking.room ? [activeBooking.room] : [];
        
        roomIds = rList.map((rm: any) => rm._id || rm);
        roomNumsList = rList.map((rm: any) => String(rm.roomNumber || '')).filter(Boolean);

        if (roomNumsList.length > 0) {
          roomNumber = roomNumsList.join(', ');
        } else if (activeBooking.roomNumbers && activeBooking.roomNumbers.length > 0) {
          roomNumber = activeBooking.roomNumbers.join(', ');
          roomNumsList = activeBooking.roomNumbers;
        } else if (activeBooking.roomNumber) {
          roomNumber = String(activeBooking.roomNumber);
          roomNumsList = [roomNumber];
        }

        if (activeBooking.checkInDate) {
          checkInStr = new Date(activeBooking.checkInDate).toLocaleDateString('en-IN');
        }
        if (activeBooking.checkOutDate) {
          checkOutStr = new Date(activeBooking.checkOutDate).toLocaleDateString('en-IN');
        }
      }

      const guestDue = Number(activeBooking?.dueAmount ?? 0);
      const guestPaid = Number(activeBooking?.paidAmount ?? 0);
      const guestTotal = Number(activeBooking?.totalAmount ?? 0);

      let guestPaymentStatus = 'PENDING';
      if (activeBooking) {
        if (activeBooking.paymentStatus) {
          const rawStatus = String(activeBooking.paymentStatus).toUpperCase();
          if (rawStatus === 'PAID') guestPaymentStatus = 'PAID';
          else if (rawStatus === 'PARTIALLY_PAID' || rawStatus === 'PARTIAL') guestPaymentStatus = 'PARTIAL';
          else if (rawStatus === 'PENDING') {
            if (guestDue <= 0 && (guestPaid > 0 || guestTotal > 0)) {
              guestPaymentStatus = 'PAID';
            } else if (guestPaid > 0) {
              guestPaymentStatus = 'PARTIAL';
            } else {
              guestPaymentStatus = 'PENDING';
            }
          } else {
            guestPaymentStatus = rawStatus;
          }
        } else if (guestDue <= 0 && (guestPaid > 0 || guestTotal > 0)) {
          guestPaymentStatus = 'PAID';
        } else if (guestPaid > 0) {
          guestPaymentStatus = 'PARTIAL';
        } else {
          guestPaymentStatus = 'PENDING';
        }
      }

      return {
        ...gObj,
        name: gObj.fullName,
        phone: gObj.mobileNumber,
        status: stayStatus,
        roomAssigned: roomNumber,
        roomNumber: roomNumber,
        roomNumbers: roomNumsList,
        roomIds,
        checkInDate: checkInStr,
        checkOutDate: checkOutStr,
        checkInDateRaw: activeBooking?.checkInDate || null,
        checkOutDateRaw: activeBooking?.checkOutDate || null,
        totalVisits: guestBookings.length || 1,
        activeBookingNumber: activeBooking?.bookingNumber || 'N/A',
        paymentStatus: guestPaymentStatus,
        balanceAmount: guestDue,
        dueAmount: guestDue,
        advanceAmount: guestPaid,
        paidAmount: guestPaid,
        totalAmount: guestTotal,
        accompanyingGuests: activeBooking?.accompanyingGuests || [],
        idType: gObj.idProof?.idType || 'AADHAAR',
        idNumber: gObj.idProof?.idNumber || 'N/A',
        govtIdType: gObj.idProof?.idType || 'AADHAAR',
        govtIdNumber: gObj.idProof?.idNumber || 'N/A',
        idVerified: gObj.idProof?.verificationStatus === 'VERIFIED',
      };
    });

    let finalGuests = formattedGuests;

    const filterStatus = String(req.query.status || req.query.type || '').toUpperCase();
    if (filterStatus && filterStatus !== 'ALL') {
      if (filterStatus === 'IN-HOUSE' || filterStatus === 'IN_HOUSE' || filterStatus === 'CHECKED_IN') {
        finalGuests = formattedGuests.filter((g) => g.status === 'IN-HOUSE' || g.status === 'CHECKED_IN');
      } else if (filterStatus === 'CHECKED_OUT' || filterStatus === 'DEPARTED') {
        finalGuests = formattedGuests.filter((g) => g.status === 'CHECKED_OUT' || g.status === 'DEPARTED');
      } else if (filterStatus === 'RESERVED' || filterStatus === 'CONFIRMED') {
        finalGuests = formattedGuests.filter((g) => g.status === 'RESERVED' || g.status === 'CONFIRMED');
      } else {
        finalGuests = formattedGuests.filter((g) => g.status?.toUpperCase() === filterStatus);
      }
    }

    const total = finalGuests.length;

    if (limit && Number(limit) > 0) {
      const pageNum = Number(page) || 1;
      const limitNum = Number(limit);
      finalGuests = finalGuests.slice((pageNum - 1) * limitNum, (pageNum - 1) * limitNum + limitNum);
    }

    res.status(200).json({
      success: true,
      total,
      count: finalGuests.length,
      page: Number(page) || 1,
      totalPages: limit && Number(limit) > 0 ? Math.ceil(total / Number(limit)) : 1,
      data: finalGuests,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get Detailed Guest Profile with Bookings, Multi-Rooms, Payments & Timeline
// @route   GET /api/v1/receptionist/guests/:id
export const getGuestDetailsById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const guestId = req.params.id;
    const hotelId = req.hotelId || req.user?.hotel;

    if (!guestId) {
      res.status(400).json({ success: false, message: 'Guest ID is required.' });
      return;
    }

    let guest: any = null;
    let fallbackBooking: any = null;
    const isMongoId = mongoose.isValidObjectId(guestId);

    if (isMongoId) {
      // 1. Try finding guest by ID and hotel
      guest = await Guest.findOne({ _id: guestId, hotel: hotelId, isDeleted: { $ne: true } });

      // 2. If not found by hotel, check if guest exists generally
      if (!guest) {
        guest = await Guest.findOne({ _id: guestId, isDeleted: { $ne: true } });
      }

      // 3. If still not found, check if guestId is actually a Booking ID
      if (!guest) {
        const b = await Booking.findOne({ _id: guestId, hotel: hotelId })
          .populate('guest')
          .populate('room')
          .populate('rooms')
          .populate('roomType');

        if (b) {
          fallbackBooking = b;
          if (b.guest && typeof b.guest === 'object') {
            guest = b.guest;
          }
        }
      }
    }

    // 4. If still not found, try finding by phone number or email
    if (!guest) {
      guest = await Guest.findOne({
        hotel: hotelId,
        isDeleted: { $ne: true },
        $or: [{ mobileNumber: guestId }, { email: guestId }],
      });
    }

    // 5. If still no guest document, but we have a booking or can find a booking by phone/id
    if (!guest) {
      if (!fallbackBooking && isMongoId) {
        fallbackBooking = await Booking.findOne({ _id: guestId }).populate('room rooms roomType');
      }
      if (!fallbackBooking) {
        fallbackBooking = await Booking.findOne({
          hotel: hotelId,
          $or: [{ guestPhone: guestId }, { guestEmail: guestId }],
        }).populate('room rooms roomType');
      }

      if (fallbackBooking) {
        guest = {
          _id: fallbackBooking.guest?._id || fallbackBooking._id,
          fullName: fallbackBooking.guestName || (fallbackBooking.guest as any)?.fullName || 'Walk-in Guest',
          mobileNumber: fallbackBooking.guestPhone || (fallbackBooking.guest as any)?.mobileNumber || '',
          email: fallbackBooking.guestEmail || (fallbackBooking.guest as any)?.email || '',
          address: fallbackBooking.guestAddress || '',
          city: (fallbackBooking.guest as any)?.city || '',
          state: (fallbackBooking.guest as any)?.state || '',
          idProof: (fallbackBooking.guest as any)?.idProof || fallbackBooking.idProof || {
            frontImage: fallbackBooking.frontImage || '',
            backImage: fallbackBooking.backImage || '',
          },
          totalVisits: 1,
          totalSpent: fallbackBooking.totalAmount || 0,
          status: fallbackBooking.status === 'CHECKED_IN' ? 'IN-HOUSE' : fallbackBooking.status,
          createdAt: fallbackBooking.createdAt,
        };
      }
    }

    if (!guest) {
      res.status(404).json({ success: false, message: 'Guest profile not found.' });
      return;
    }

    // Find all bookings for this guest or related booking
    const guestSearchIds = [guest._id];
    if (fallbackBooking && fallbackBooking._id) {
      guestSearchIds.push(fallbackBooking._id);
    }

    const bookingOrConditions: any[] = [
      { guest: { $in: guestSearchIds } },
      { _id: { $in: guestSearchIds } },
    ];
    if (guest.mobileNumber) {
      bookingOrConditions.push({ guestPhone: guest.mobileNumber });
    }

    const allBookings = await Booking.find({
      hotel: hotelId,
      isDeleted: { $ne: true },
      $or: bookingOrConditions,
    })
      .populate('room', 'roomNumber floor status customPricePerNight pricePerNight')
      .populate('rooms', 'roomNumber floor status customPricePerNight pricePerNight')
      .populate('roomType', 'name basePrice gstRate')
      .sort({ createdAt: -1 });

    const activeBooking =
      allBookings.find((b) => b.status === 'CHECKED_IN') ||
      allBookings.find((b) => b.status === 'CONFIRMED') ||
      fallbackBooking ||
      allBookings[0] || null;

    if (activeBooking) {
      const checkInStr = activeBooking.checkInDate ? new Date(activeBooking.checkInDate).toISOString().split('T')[0] : '';
      const checkOutStr = activeBooking.checkOutDate ? new Date(activeBooking.checkOutDate).toISOString().split('T')[0] : '';
      if (checkInStr && checkOutStr) {
        const [y1, m1, d1] = checkInStr.split('-').map(Number);
        const [y2, m2, d2] = checkOutStr.split('-').map(Number);
        const trueNights = Math.max(1, Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / (1000 * 60 * 60 * 24)));
        if (activeBooking.numberOfNights && activeBooking.numberOfNights > trueNights) {
          const oldNights = activeBooking.numberOfNights;
          activeBooking.numberOfNights = trueNights;
          activeBooking.totalAmount = Math.round((activeBooking.totalAmount / oldNights) * trueNights);
          activeBooking.dueAmount = Math.max(0, activeBooking.totalAmount - (activeBooking.paidAmount || 0));
          activeBooking.save().catch(() => {});
        }
      }
    }

    // Multi-Room Breakdown for active booking
    let roomsDetail: any[] = [];
    if (activeBooking) {
      const rList = Array.isArray(activeBooking.rooms) && activeBooking.rooms.length > 0
        ? activeBooking.rooms
        : activeBooking.room ? [activeBooking.room] : [];

      roomsDetail = rList.map((rm: any) => {
        const tariff = Number(rm.customPricePerNight) || Number(rm.pricePerNight) || Number((activeBooking.roomType as any)?.basePrice) || 3000;
        const nights = activeBooking.numberOfNights || 1;
        const rtName = (typeof rm.roomType === 'object' && rm.roomType?.name) ? rm.roomType.name : ((activeBooking.roomType as any)?.name || rm.roomType || 'Standard Room');
        const fl = rm.floor !== undefined && rm.floor !== null ? rm.floor : (parseInt(String(rm.roomNumber || ''), 10) >= 100 ? Math.floor(parseInt(String(rm.roomNumber || ''), 10) / 100) : 1);
        return {
          id: rm._id,
          roomNumber: rm.roomNumber,
          roomType: rtName,
          floor: fl,
          pricePerNight: tariff,
          numberOfNights: nights,
          roomTotal: tariff * nights,
          status: rm.status || 'OCCUPIED',
        };
      });
    }

    // Payment History from Payment Collection
    const paymentOrConditions: any[] = [{ guest: guest._id }, { hotel: hotelId, guest: { $in: guestSearchIds } }];
    if (activeBooking) {
      paymentOrConditions.push({ booking: activeBooking._id });
    }
    const payments = await Payment.find({
      $or: paymentOrConditions,
    }).sort({ createdAt: -1 });

    const paymentHistory = payments.map((p) => {
      let desc = 'Room Booking';
      if (p.paymentType === 'ADVANCE') desc = 'Advance Booking Payment';
      else if (p.paymentType === 'EXTRA_CHARGE') desc = 'Extra Services / Food Charge';
      else if (p.paymentType === 'PARTIAL') desc = 'Part Payment';
      else if (p.paymentType === 'FULL_SETTLEMENT') desc = 'Full Check-in / Checkout Settlement';
      if (p.note) desc += ` - ${p.note}`;

      const taxPortion = activeBooking?.taxAmount ? Math.round(p.amount * 0.18 / 1.18) : 0;
      const basePortion = Math.max(0, p.amount - taxPortion);

      return {
        id: p._id,
        date: p.createdAt,
        formattedDate: new Date(p.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        transactionId: p.transactionId || p.receiptNumber,
        receiptNumber: p.receiptNumber,
        description: desc,
        paymentMethod: p.paymentMethod || 'UPI',
        amount: basePortion,
        gst: taxPortion,
        total: p.amount,
        status: p.paymentStatus || 'PAID',
      };
    });

    // Activity Timeline from DB Timestamps
    const timeline: any[] = [];
    if (activeBooking) {
      timeline.push({
        title: 'Booking Created',
        description: `Booking #${activeBooking.bookingNumber} created for ${activeBooking.numberOfNights} night(s).`,
        timestamp: activeBooking.createdAt,
        icon: 'EventNote',
        status: 'completed',
      });

      if (payments.length > 0) {
        timeline.push({
          title: 'Payment Received',
          description: `Payment of ₹${payments.reduce((sum, p) => sum + p.amount, 0).toLocaleString()} received via ${payments[0]?.paymentMethod || 'UPI'}.`,
          timestamp: payments[payments.length - 1].createdAt,
          icon: 'Payments',
          status: 'completed',
        });
      }

      if (roomsDetail.length > 0) {
        timeline.push({
          title: 'Room Allocated',
          description: `Allocated Room ${roomsDetail.map((r) => `#${r.roomNumber}`).join(', ')} (${roomsDetail.map((r) => r.roomType).join(', ')}).`,
          timestamp: activeBooking.createdAt,
          icon: 'MeetingRoom',
          status: 'completed',
        });
      }

      if (activeBooking.status === 'CHECKED_IN' || activeBooking.actualCheckIn) {
        timeline.push({
          title: 'Checked In',
          description: `Guest checked in to Room ${roomsDetail.map((r) => `#${r.roomNumber}`).join(', ')}.`,
          timestamp: activeBooking.actualCheckIn || activeBooking.checkInDate,
          icon: 'CheckCircle',
          status: 'completed',
        });
      }

      const charges = await BookingCharge.find({ booking: activeBooking._id });
      charges.forEach((c) => {
        timeline.push({
          title: `Additional Charge: ${c.title}`,
          description: `${c.type} charge of ₹${c.totalAmount.toLocaleString()} added.`,
          timestamp: c.createdAt,
          icon: 'RoomService',
          status: 'completed',
        });
      });

      if (activeBooking.status === 'CHECKED_OUT' || activeBooking.actualCheckOut) {
        timeline.push({
          title: 'Checked Out',
          description: 'Folio closed and checkout finalized.',
          timestamp: activeBooking.actualCheckOut || activeBooking.checkOutDate,
          icon: 'DoneAll',
          status: 'completed',
        });
      }
    }

    timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    res.status(200).json({
      success: true,
      data: {
        guest,
        activeBooking,
        roomsDetail,
        paymentDetails: activeBooking ? {
          baseAmount: activeBooking.baseAmount || 0,
          gstAmount: activeBooking.gstAmount || activeBooking.taxAmount || 0,
          cgstAmount: activeBooking.cgstAmount || (activeBooking.taxAmount ? Math.round(activeBooking.taxAmount / 2) : 0),
          sgstAmount: activeBooking.sgstAmount || (activeBooking.taxAmount ? Math.round(activeBooking.taxAmount / 2) : 0),
          discountAmount: activeBooking.discountAmount || 0,
          paidAmount: activeBooking.paidAmount || 0,
          dueAmount: activeBooking.dueAmount || 0,
          paymentMethod: payments[0]?.paymentMethod || 'UPI',
          paymentStatus: activeBooking.dueAmount === 0 ? 'PAID' : activeBooking.paidAmount > 0 ? 'PARTIALLY_PAID' : 'PENDING',
        } : null,
        paymentHistory,
        timeline,
        allBookings,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete a Guest record (Safe Soft Delete & Hard Delete Guard)
// @route   DELETE /api/v1/receptionist/guests/:id
export const deleteGuest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const isPermanent = req.query.permanent === 'true' || req.body?.permanent === true;
    const guest = await Guest.findOne({ _id: req.params.id, hotel: req.hotelId });
    if (!guest) {
      res.status(404).json({ success: false, message: 'Guest not found.' });
      return;
    }

    if (isPermanent) {
      const linkedBookingsCount = await Booking.countDocuments({ hotel: req.hotelId, guest: guest._id });
      if (linkedBookingsCount > 0) {
        res.status(400).json({
          success: false,
          message: `Cannot permanently delete guest '${guest.fullName}' because ${linkedBookingsCount} stay/compliance records exist. Please use soft delete.`,
        });
        return;
      }

      await Guest.findByIdAndDelete(guest._id);
      res.status(200).json({ success: true, message: `Guest '${guest.fullName}' permanently deleted.` });
    } else {
      guest.isDeleted = true;
      await guest.save();
      res.status(200).json({ success: true, message: `Guest '${guest.fullName}' soft-deleted (archived). Regulatory audit ledger preserved.` });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get All Bookings for this Hotel
// @route   GET /api/v1/receptionist/bookings
export const getBookingsList = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { status, page, limit } = req.query;
    const query: any = { hotel: req.hotelId };

    if (status && status !== 'ALL') {
      query.status = status;
    }

    const total = await Booking.countDocuments(query);
    let bookingQuery = Booking.find(query)
      .populate('guest')
      .populate('room')
      .populate('roomType')
      .sort({ createdAt: -1 });

    if (limit && Number(limit) > 0) {
      const pageNum = Number(page) || 1;
      const limitNum = Number(limit);
      bookingQuery = bookingQuery.skip((pageNum - 1) * limitNum).limit(limitNum);
    }

    const bookings = await bookingQuery;

    const bookingIds = bookings.map((b) => b._id);
    const charges = await BookingCharge.find({ booking: { $in: bookingIds } });

    const chargesByBooking: { [key: string]: any[] } = {};
    charges.forEach((c) => {
      const bId = c.booking.toString();
      if (!chargesByBooking[bId]) chargesByBooking[bId] = [];
      chargesByBooking[bId].push({
        _id: c._id,
        item: c.title,
        title: c.title,
        amount: c.amount,
        type: c.type,
        createdAt: c.createdAt,
      });
    });

    const formattedBookings = bookings.map((b) => {
      const bObj = b.toObject();
      const guestObj = bObj.guest as any;
      const roomObj = bObj.room as any;

      const checkInDateStr = bObj.checkInDate ? new Date(bObj.checkInDate).toISOString().split('T')[0] : '';
      const checkOutDateStr = bObj.checkOutDate ? new Date(bObj.checkOutDate).toISOString().split('T')[0] : '';

      // Auto-heal any booking with miscalculated night count (e.g. 1 night booked with 2 nights tariff)
      if (checkInDateStr && checkOutDateStr) {
        const [y1, m1, d1] = checkInDateStr.split('-').map(Number);
        const [y2, m2, d2] = checkOutDateStr.split('-').map(Number);
        const trueNights = Math.max(1, Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / (1000 * 60 * 60 * 24)));
        if (b.numberOfNights && b.numberOfNights > trueNights) {
          const oldNights = b.numberOfNights;
          b.numberOfNights = trueNights;
          b.totalAmount = Math.round((b.totalAmount / oldNights) * trueNights);
          b.dueAmount = Math.max(0, b.totalAmount - (b.paidAmount || 0));
          b.save().catch(() => {});
          bObj.numberOfNights = trueNights;
          bObj.totalAmount = b.totalAmount;
          bObj.dueAmount = b.dueAmount;
        }
      }

      return {
        ...bObj,
        guest: guestObj
          ? {
              _id: guestObj._id,
              name: guestObj.fullName,
              fullName: guestObj.fullName,
              phone: guestObj.mobileNumber,
              mobileNumber: guestObj.mobileNumber,
              email: guestObj.email,
              gender: guestObj.gender,
              address: guestObj.address,
              city: guestObj.city,
              state: guestObj.state,
              nationality: guestObj.nationality,
              idProof: guestObj.idProof || {},
              frontImage: guestObj.idProof?.frontImage || '',
              backImage: guestObj.idProof?.backImage || '',
              govtIdType: guestObj.idProof?.idType || 'AADHAAR',
              govtIdNumber: guestObj.idProof?.idNumber || '',
            }
          : { name: 'Guest', phone: '', email: '' },
        roomNumber: roomObj ? roomObj.roomNumber : 'N/A',
        checkInDate: checkInDateStr,
        checkOutDate: checkOutDateStr,
        posCharges: chargesByBooking[b._id.toString()] || [],
      };
    });

    res.status(200).json({
      success: true,
      total,
      count: formattedBookings.length,
      page: Number(page) || 1,
      totalPages: limit && Number(limit) > 0 ? Math.ceil(total / Number(limit)) : 1,
      data: formattedBookings,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Quick lookup guest by phone, email, or idNumber with Repeat Guest stats
// @route   GET /api/v1/receptionist/guests/lookup
export const lookupGuest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { phone, mobile, query, idNumber } = req.query;
    const searchTerm = (phone || mobile || query || idNumber || '').toString().trim();
    if (!searchTerm) {
      res.status(400).json({ success: false, message: 'Search query (phone, email or ID) is required.' });
      return;
    }

    const guest = await Guest.findOne({
      hotel: req.hotelId,
      isDeleted: { $ne: true },
      $or: [
        { mobileNumber: searchTerm },
        { mobileNumber: { $regex: searchTerm, $options: 'i' } },
        { 'idProof.idNumber': searchTerm },
        { email: searchTerm },
        { fullName: { $regex: searchTerm, $options: 'i' } },
      ],
    });

    if (!guest) {
      res.status(200).json({ success: true, isRepeatGuest: false, data: null, message: 'New guest. No prior profile found.' });
      return;
    }

    const previousBookings = await Booking.find({ hotel: req.hotelId, guest: guest._id })
      .sort({ createdAt: -1 })
      .populate('room', 'roomNumber');

    const totalStays = Math.max(guest.totalVisits || 1, previousBookings.length);
    const lastStay = previousBookings.length > 0 ? previousBookings[0].checkInDate : guest.updatedAt;
    const hasValidGovtId = Boolean(
      guest.idProof?.idNumber &&
      guest.idProof.idNumber !== 'PENDING' &&
      guest.idProof.verificationStatus === 'VERIFIED'
    );

    res.status(200).json({
      success: true,
      isRepeatGuest: totalStays > 0,
      data: {
        _id: guest._id,
        fullName: guest.fullName,
        mobileNumber: guest.mobileNumber,
        email: guest.email,
        gender: guest.gender,
        address: guest.address,
        city: guest.city,
        state: guest.state,
        nationality: guest.nationality,
        emergencyContact: guest.emergencyContact,
        idProof: guest.idProof,
        totalVisits: totalStays,
        isRepeatGuest: totalStays > 0,
        lastStayDate: lastStay,
        hasValidGovtId,
        previousBookings: previousBookings.slice(0, 5).map((b) => ({
          bookingNumber: b.bookingNumber,
          roomNumber: (b.room as any)?.roomNumber || 'N/A',
          checkInDate: b.checkInDate,
          checkOutDate: b.checkOutDate,
          status: b.status,
          totalAmount: b.totalAmount,
        })),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get All Payments & Billing Collections Ledger with Breakdown
// @route   GET /api/v1/receptionist/payments or /api/v1/admin/payments

export const getPaymentsLedger = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { paymentMethod, paymentType, timeRange, startDate, endDate, search } = req.query;
    const hotelId = req.hotelId;

    const query: any = { hotel: hotelId };

    // Method filter
    if (paymentMethod && paymentMethod !== 'ALL') {
      query.paymentMethod = paymentMethod;
    }

    // Type filter
    if (paymentType && paymentType !== 'ALL') {
      query.paymentType = paymentType;
    }

    // Date Range calculation
    const now = new Date();
    if (timeRange === 'today') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: start, $lte: end };
    } else if (timeRange === 'yesterday') {
      const start = new Date();
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: start, $lte: end };
    } else if (timeRange === 'this_week' || timeRange === 'week') {
      const start = new Date();
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: start };
    } else if (timeRange === 'this_month' || timeRange === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      query.createdAt = { $gte: start };
    } else if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(String(startDate));
      if (endDate) {
        const end = new Date(String(endDate));
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    // Search filter
    if (search) {
      const searchStr = String(search).trim();
      // Look up guests matching name or phone
      const matchedGuests = await Guest.find({
        hotel: hotelId,
        $or: [
          { fullName: { $regex: searchStr, $options: 'i' } },
          { mobileNumber: { $regex: searchStr, $options: 'i' } },
        ],
      }).select('_id');
      const guestIds = matchedGuests.map((g) => g._id);

      // Look up bookings matching bookingNumber
      const matchedBookings = await Booking.find({
        hotel: hotelId,
        bookingNumber: { $regex: searchStr, $options: 'i' },
      }).select('_id');
      const bookingIds = matchedBookings.map((b) => b._id);

      query.$or = [
        { receiptNumber: { $regex: searchStr, $options: 'i' } },
        { transactionId: { $regex: searchStr, $options: 'i' } },
        { paymentReference: { $regex: searchStr, $options: 'i' } },
        { note: { $regex: searchStr, $options: 'i' } },
        ...(guestIds.length > 0 ? [{ guest: { $in: guestIds } }] : []),
        ...(bookingIds.length > 0 ? [{ booking: { $in: bookingIds } }] : []),
      ];
    }

    // Retrieve Payments
    const payments = await Payment.find(query)
      .populate('guest', 'fullName mobileNumber email')
      .populate({
        path: 'booking',
        select: 'bookingNumber room roomType totalAmount paidAmount dueAmount checkInDate checkOutDate status',
        populate: { path: 'room', select: 'roomNumber status' },
      })
      .populate('collectedBy', 'name email role')
      .sort({ createdAt: -1 });

    // Global aggregations for the current hotel
    const allHotelPayments = await Payment.find({ hotel: hotelId, paymentStatus: 'PAID' });
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    let totalGrossCollected = 0;
    let todayCollected = 0;
    let cashTotal = 0;
    let upiTotal = 0;
    let cardTotal = 0;
    let bankTotal = 0;
    let onlineTotal = 0;
    let todayCash = 0;
    let todayUpi = 0;
    let todayCard = 0;
    let todayBank = 0;
    let advanceTotal = 0;
    let settlementTotal = 0;
    let extraChargeTotal = 0;

    allHotelPayments.forEach((p) => {
      const amt = Number(p.amount) || 0;
      totalGrossCollected += amt;
      const pDate = new Date(p.createdAt);
      const isToday = pDate >= startOfToday && pDate <= endOfToday;

      if (isToday) {
        todayCollected += amt;
      }

      if (p.paymentMethod === 'CASH') {
        cashTotal += amt;
        if (isToday) todayCash += amt;
      } else if (p.paymentMethod === 'UPI') {
        upiTotal += amt;
        if (isToday) todayUpi += amt;
      } else if (p.paymentMethod === 'CARD') {
        cardTotal += amt;
        if (isToday) todayCard += amt;
      } else if (p.paymentMethod === 'BANK_TRANSFER') {
        bankTotal += amt;
        if (isToday) todayBank += amt;
      } else {
        onlineTotal += amt;
      }

      if (p.paymentType === 'ADVANCE') advanceTotal += amt;
      else if (p.paymentType === 'FULL_SETTLEMENT') settlementTotal += amt;
      else if (p.paymentType === 'EXTRA_CHARGE') extraChargeTotal += amt;
    });

    // Total outstanding dues in active bookings
    const activeBookings = await Booking.find({
      hotel: hotelId,
      status: { $in: ['CHECKED_IN', 'CONFIRMED'] },
    });
    const totalPendingDues = activeBookings.reduce((sum, b) => sum + (Number(b.dueAmount) || 0), 0);

    const formattedPayments = payments.map((p) => {
      const pObj = p.toObject();
      const guestObj = pObj.guest as any;
      const bookingObj = pObj.booking as any;
      const roomObj = bookingObj?.room as any;
      const collector = pObj.collectedBy as any;

      return {
        _id: pObj._id,
        receiptNumber: pObj.receiptNumber,
        amount: pObj.amount,
        paymentMethod: pObj.paymentMethod,
        paymentType: pObj.paymentType,
        paymentStatus: pObj.paymentStatus,
        transactionId: pObj.transactionId || 'N/A',
        paymentReference: pObj.paymentReference || '',
        note: pObj.note || '',
        createdAt: pObj.createdAt,
        timestamp: new Date(pObj.createdAt).toLocaleString('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
        dateStr: new Date(pObj.createdAt).toISOString().split('T')[0],
        timeStr: new Date(pObj.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        guest: {
          _id: guestObj?._id,
          fullName: guestObj?.fullName || 'Walk-in Guest',
          mobileNumber: guestObj?.mobileNumber || 'N/A',
          email: guestObj?.email || '',
        },
        booking: {
          _id: bookingObj?._id,
          bookingNumber: bookingObj?.bookingNumber || 'N/A',
          roomNumber: roomObj?.roomNumber || 'N/A',
          totalAmount: bookingObj?.totalAmount || 0,
          paidAmount: bookingObj?.paidAmount || 0,
          dueAmount: bookingObj?.dueAmount || 0,
          status: bookingObj?.status || 'N/A',
        },
        collectedBy: {
          _id: collector?._id,
          name: collector?.name || 'Front Desk Staff',
          role: collector?.role || 'RECEPTIONIST',
        },
      };
    });

    res.status(200).json({
      success: true,
      count: formattedPayments.length,
      summary: {
        totalGrossCollected,
        todayCollected,
        cashTotal,
        upiTotal,
        cardTotal,
        bankTotal,
        onlineTotal,
        todayCash,
        todayUpi,
        todayCard,
        todayBank,
        advanceTotal,
        settlementTotal,
        extraChargeTotal,
        totalPendingDues,
        totalTransactions: allHotelPayments.length,
      },
      data: formattedPayments,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Record an Ad-Hoc / Direct Folio Payment (Cash, UPI, Card POS, NEFT)
// @route   POST /api/v1/receptionist/payments or /api/v1/admin/payments
export const recordDirectPayment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { bookingId, amount, paymentMethod = 'CASH', paymentType = 'PARTIAL', transactionId, paymentReference, note } = req.body;

    if (!bookingId || !amount || Number(amount) <= 0) {
      res.status(400).json({ success: false, message: 'Valid booking ID and positive payment amount are required.' });
      return;
    }

    const booking = await Booking.findOne({ _id: bookingId, hotel: req.hotelId }).populate('guest').populate('room');
    if (!booking) {
      res.status(404).json({ success: false, message: 'Booking not found.' });
      return;
    }

    const cleanPaymentMethod = normalizePaymentMethod(paymentMethod);
    const payAmt = Number(amount);
    const receiptNumber = `RCP-${Date.now().toString().slice(-6)}`;

    // Update booking financials
    booking.paidAmount += payAmt;
    booking.dueAmount = Math.max(0, booking.totalAmount - booking.paidAmount);
    await booking.save();

    const payment = await Payment.create({
      hotel: req.hotelId,
      booking: booking._id,
      guest: booking.guest,
      collectedBy: req.user?._id,
      receiptNumber,
      amount: payAmt,
      paymentMethod: cleanPaymentMethod,
      paymentType: paymentType || (booking.dueAmount === 0 ? 'FULL_SETTLEMENT' : 'PARTIAL'),
      paymentStatus: 'PAID',
      transactionId: transactionId || '',
      paymentReference: paymentReference || '',
      note: note || `Payment collected via ${cleanPaymentMethod}`,
    });

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: 'PAYMENT_RECORDED',
        module: 'PAYMENTS',
        entityId: receiptNumber,
        newValue: {
          amount: payAmt,
          method: cleanPaymentMethod,
          bookingNumber: booking.bookingNumber,
          balanceRemaining: booking.dueAmount,
        },
      });
    }

    emitToHotel(req.hotelId, 'PAYMENT_RECORDED', {
      payment,
      receiptNumber,
      bookingNumber: booking.bookingNumber,
      amount: payAmt,
    });
    emitToHotel(req.hotelId, 'BOOKING_UPDATED', {
      bookingId: booking._id,
      dueAmount: booking.dueAmount,
      paidAmount: booking.paidAmount,
    });
    emitToHotel(req.hotelId, 'DASHBOARD_SYNC', { type: 'PAYMENT' });

    res.status(201).json({
      success: true,
      message: `₹${payAmt.toLocaleString()} payment recorded successfully (Receipt: ${receiptNumber})!`,
      data: {
        payment,
        receiptNumber,
        bookingSummary: {
          bookingNumber: booking.bookingNumber,
          totalAmount: booking.totalAmount,
          paidAmount: booking.paidAmount,
          dueAmount: booking.dueAmount,
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Zero-OTP Automated ID Verification via Surepass OCR (Aadhaar / DL Image)
// @route   POST /api/v1/receptionist/kyc/ocr-verify
export const ocrVerifyGovtId = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      idType = 'AADHAAR',
      frontImage,
      backImage,
      idNumber,
      dob,
      guestId,
      mobileNumber,
    } = req.body;

    const normalizedType = (idType || 'AADHAAR').toUpperCase();

    let result;
    if (normalizedType === 'DRIVING_LICENSE') {
      result = await extractAndVerifyDrivingLicense(frontImage, idNumber, dob);
    } else {
      // Default to Aadhaar
      result = await extractAndVerifyAadhaarOCR(frontImage, backImage, idNumber);
    }

    if (!result.success) {
      res.status(400).json({ success: false, message: result.message });
      return;
    }

    // Auto-update or associate guest in DB if guestId or mobileNumber is provided
    let updatedGuest = null;
    if (guestId) {
      updatedGuest = await Guest.findOne({ _id: guestId, hotel: req.hotelId });
    } else if (mobileNumber) {
      updatedGuest = await Guest.findOne({ mobileNumber: mobileNumber.trim(), hotel: req.hotelId });
    }

    if (updatedGuest) {
      let ocrFront = frontImage;
      let ocrBack = backImage;
      if (ocrFront && ocrFront.startsWith('data:image')) {
        ocrFront = await uploadToCloudinary(ocrFront, 'hotel_guest_documents/main');
      }
      if (ocrBack && ocrBack.startsWith('data:image')) {
        ocrBack = await uploadToCloudinary(ocrBack, 'hotel_guest_documents/main');
      }

      updatedGuest.idProof = {
        idType: result.data.idType,
        idNumber: result.data.idNumber,
        frontImage: ocrFront || updatedGuest.idProof?.frontImage || '',
        backImage: ocrBack || updatedGuest.idProof?.backImage || '',
        verificationStatus: 'VERIFIED',
        verifiedBy: req.user?._id as any,
        verifiedAt: new Date(),
        verificationNotes: `Verified via ${result.source === 'LIVE_SUREPASS' ? 'Surepass OCR API' : 'Surepass Engine (Confidence: ' + result.data.confidenceScore + '%)'}.`,
      };

      if (result.data.fullName && (!updatedGuest.fullName || updatedGuest.fullName === 'Guest')) {
        updatedGuest.fullName = result.data.fullName;
      }
      if (result.data.address && !updatedGuest.address) {
        updatedGuest.address = result.data.address;
      }
      if (result.data.city && !updatedGuest.city) {
        updatedGuest.city = result.data.city;
      }
      if (result.data.state && !updatedGuest.state) {
        updatedGuest.state = result.data.state;
      }

      await updatedGuest.save();

      if (req.user) {
        await logAuditAction({
          user: req.user,
          action: 'SUREPASS_OCR_ID_VERIFIED',
          module: 'GUESTS',
          entityId: updatedGuest.fullName,
          newValue: {
            idType: result.data.idType,
            idNumber: result.data.idNumber,
            source: result.source,
          },
        });
      }
    }

    res.status(200).json({
      success: true,
      message: result.message,
      source: result.source,
      extractedData: result.data,
      guest: updatedGuest,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Direct Number & DOB Verification for Driving License (Parivahan Registry)
// @route   POST /api/v1/receptionist/kyc/verify-driving-license
export const directVerifyDrivingLicense = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { dlNumber, dob, guestId, mobileNumber } = req.body;

    if (!dlNumber || !dob) {
      res.status(400).json({
        success: false,
        message: 'Driving License Number and Date of Birth (YYYY-MM-DD) are required.',
      });
      return;
    }

    const result = await extractAndVerifyDrivingLicense(undefined, dlNumber, dob);

    if (!result.success) {
      res.status(400).json({ success: false, message: result.message });
      return;
    }

    let updatedGuest = null;
    if (guestId) {
      updatedGuest = await Guest.findOne({ _id: guestId, hotel: req.hotelId });
    } else if (mobileNumber) {
      updatedGuest = await Guest.findOne({ mobileNumber: mobileNumber.trim(), hotel: req.hotelId });
    }

    if (updatedGuest) {
      updatedGuest.idProof = {
        idType: 'DRIVING_LICENSE',
        idNumber: result.data.idNumber,
        frontImage: updatedGuest.idProof?.frontImage || '',
        backImage: updatedGuest.idProof?.backImage || '',
        verificationStatus: 'VERIFIED',
        verifiedBy: req.user?._id as any,
        verifiedAt: new Date(),
        verificationNotes: `Verified via ${result.source === 'LIVE_SUREPASS' ? 'Surepass National Registry' : 'Surepass DL Validator'}.`,
      };
      if (result.data.fullName) updatedGuest.fullName = result.data.fullName;
      if (result.data.address) updatedGuest.address = result.data.address;
      await updatedGuest.save();
    }

    res.status(200).json({
      success: true,
      message: result.message,
      source: result.source,
      extractedData: result.data,
      guest: updatedGuest,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Save / Update Guest Digital Signature
 * POST /api/v1/receptionist/guests/:id/signature
 */
export const saveGuestSignature = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { signature } = req.body;

    if (!signature) {
      res.status(400).json({ success: false, message: 'Signature data is required' });
      return;
    }

    const guest = await Guest.findOne({ _id: id, hotel: req.hotelId, isDeleted: false });
    if (!guest) {
      res.status(404).json({ success: false, message: 'Guest record not found' });
      return;
    }

    guest.signature = signature;
    guest.signatureDate = new Date();
    await guest.save();

    res.status(200).json({
      success: true,
      message: 'Guest signature saved successfully',
      data: {
        guestId: guest._id,
        signature: guest.signature,
        signatureDate: guest.signatureDate,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Save / Update Booking Guest Digital Signature
 * POST /api/v1/receptionist/bookings/:id/signature
 */
export const saveBookingSignature = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { signature } = req.body;

    if (!signature) {
      res.status(400).json({ success: false, message: 'Signature data is required' });
      return;
    }

    const booking = await Booking.findOne({ _id: id, hotel: req.hotelId });
    if (!booking) {
      res.status(404).json({ success: false, message: 'Booking record not found' });
      return;
    }

    booking.guestSignature = signature;
    booking.guestSignedAt = new Date();
    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Booking guest signature saved successfully',
      data: {
        bookingId: booking._id,
        bookingNumber: booking.bookingNumber,
        guestSignature: booking.guestSignature,
        guestSignedAt: booking.guestSignedAt,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};



