import { Response } from 'express';
import crypto from 'crypto';
import Room from '../models/Room';
import RoomType from '../models/RoomType';
import Guest from '../models/Guest';
import Booking from '../models/Booking';
import BookingCharge from '../models/BookingCharge';
import Payment from '../models/Payment';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import sendEmail from '../utils/sendEmail';
import logAuditAction from '../utils/auditLogger';
import { paymentReceiptTemplate } from '../utils/emailTemplates';
import { extractAndVerifyAadhaarOCR, extractAndVerifyDrivingLicense } from '../utils/surepassService';
import { emitToHotel } from '../utils/socketService';

// @desc    Helper to auto-resolve rooms whose 15-minute cleaning timer expired
export const resolveCleaningRooms = async (hotelId: any): Promise<void> => {
  try {
    const cleaningRooms = await Room.find({ hotel: hotelId, status: 'CLEANING', isActive: true, isDeleted: { $ne: true } });
    const now = Date.now();
    for (const r of cleaningRooms) {
      const startedAt = r.cleaningStartedAt ? new Date(r.cleaningStartedAt).getTime() : new Date(r.updatedAt).getTime();
      const durationMs = (r.cleaningDurationMinutes || 15) * 60 * 1000;
      if (now - startedAt >= durationMs) {
        r.status = 'AVAILABLE';
        await r.save();
        emitToHotel(hotelId, 'ROOM_UPDATED', { roomId: r._id, roomNumber: r.roomNumber, status: 'AVAILABLE' });
      }
    }
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

// @desc    Search Available Rooms by Dates & Type
// @route   GET /api/v1/receptionist/rooms/available
export const getAvailableRooms = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await resolveCleaningRooms(req.hotelId);
    const { roomType } = req.query;
    const query: any = { hotel: req.hotelId, isActive: true, isDeleted: { $ne: true } };

    if (roomType) query.roomType = roomType;

    const rooms = await Room.find(query).populate('roomType').sort({ roomNumber: 1 });

    // Lookup currently resident guests in occupied rooms
    const activeBookings = await Booking.find({
      hotel: req.hotelId,
      status: { $in: ['CHECKED_IN', 'CONFIRMED'] },
    }).populate('guest', 'fullName mobileNumber');

    const guestMap: { [key: string]: string } = {};
    activeBookings.forEach((b) => {
      const g = b.guest as any;
      if (g && b.room) {
        guestMap[b.room.toString()] = g.fullName;
      }
    });

    const enrichedRooms = rooms.map((r) => {
      const rObj = r.toObject();
      return {
        ...rObj,
        guestName: guestMap[r._id.toString()] || '',
      };
    });

    res.status(200).json({ success: true, count: enrichedRooms.length, data: enrichedRooms });
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
    } = req.body;

    const guestFullName = (fullName || name || '').trim();
    const guestMobile = (mobileNumber || phone || '').trim();
    const guestIdNum = (idNumber || govtIdNumber || 'PENDING').trim();
    const cleanIdType = normalizeIdType(idType || govtIdType);

    if (!guestFullName || !guestMobile) {
      res.status(400).json({
        success: false,
        message: 'Guest full name and mobile number are required.',
      });
      return;
    }

    let guest = await Guest.findOne({ hotel: req.hotelId, mobileNumber: guestMobile });

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
        frontImage: frontImage || guest.idProof?.frontImage || '',
        backImage: backImage || guest.idProof?.backImage || '',
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
          frontImage: frontImage || '',
          backImage: backImage || '',
          verificationStatus: 'PENDING',
        },
        isDeleted: false,
      });
    }

    emitToHotel(req.hotelId, 'GUEST_UPDATED', { guestId: guest._id, fullName: guest.fullName });
    res.status(200).json({ success: true, message: 'Guest details saved.', data: guest });
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
      govtIdType,
      idType,
      govtIdNumber,
      idNumber,
      roomId,
      roomNumber,
      checkInDate,
      checkOutDate,
      adults = 1,
      children = 0,
      isInstantCheckIn = true,
      advancePaymentAmount = 0,
      paymentMethod = 'CASH',
      discountAmount = 0,
      specialRequests,
    } = req.body;

    const guestName = fullName || guestPayload?.fullName || guestPayload?.name;
    const guestPhone = mobileNumber || mobile || guestPayload?.mobileNumber || guestPayload?.phone;
    const guestEmail = email || guestPayload?.email || '';
    const guestIdType = govtIdType || idType || guestPayload?.govtIdType || guestPayload?.idType || 'AADHAAR';
    const guestIdNum = govtIdNumber || idNumber || guestPayload?.govtIdNumber || guestPayload?.idNumber || 'PENDING';

    const cleanGuestIdType = normalizeIdType(guestIdType);
    const reusePreviousId = req.body.reusePreviousId === true || req.body.reusePreviousId === 'true';

    let guest: any = null;
    let isReturningGuest = false;

    if (guestId) {
      guest = await Guest.findOne({ _id: guestId, hotel: req.hotelId });
    } else if (guestPhone) {
      guest = await Guest.findOne({ hotel: req.hotelId, mobileNumber: guestPhone });
    }

    if (guest) {
      isReturningGuest = true;
      guest.totalVisits = (guest.totalVisits || 1) + 1;
      guest.isDeleted = false;
      if (guestName && guestName !== 'Walk-in Guest') guest.fullName = guestName;
      if (guestEmail) guest.email = guestEmail;

      // Handle ID Proof: If receptionist chose to reuse verified ID, keep verified status; else update
      if (!reusePreviousId && guestIdNum && guestIdNum !== 'PENDING' && guestIdNum !== guest.idProof?.idNumber) {
        guest.idProof = {
          idType: cleanGuestIdType,
          idNumber: guestIdNum,
          frontImage: req.body.frontImage || guest.idProof?.frontImage || '',
          backImage: req.body.backImage || guest.idProof?.backImage || '',
          verificationStatus: 'VERIFIED',
          verifiedBy: req.user?._id as any,
          verifiedAt: new Date(),
          verificationNotes: 'Re-verified at express check-in',
        };
      } else if (!guest.idProof?.idNumber || guest.idProof?.idNumber === 'PENDING') {
        guest.idProof = {
          idType: cleanGuestIdType,
          idNumber: guestIdNum || 'PENDING',
          verificationStatus: guestIdNum && guestIdNum !== 'PENDING' ? 'VERIFIED' : 'PENDING',
        };
      }
      await guest.save();
    } else {
      guest = await Guest.create({
        hotel: req.hotelId,
        fullName: guestName || 'Walk-in Guest',
        mobileNumber: guestPhone,
        email: guestEmail,
        idProof: {
          idType: cleanGuestIdType,
          idNumber: guestIdNum,
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

    let room: any = null;
    if (roomId) {
      room = await Room.findOne({ _id: roomId, hotel: req.hotelId }).populate('roomType');
    } else if (roomNumber) {
      room = await Room.findOne({ hotel: req.hotelId, roomNumber }).populate('roomType');
    }

    if (!room) {
      // Find any available room or first room
      room = await Room.findOne({ hotel: req.hotelId, status: 'AVAILABLE' }).populate('roomType');
      if (!room) {
        room = await Room.findOne({ hotel: req.hotelId }).populate('roomType');
      }
    }

    if (!room) {
      res.status(404).json({ success: false, message: 'No valid room found for allocation. Please create rooms first.' });
      return;
    }

    const cInDate = checkInDate ? new Date(checkInDate) : new Date();
    const cOutDate = checkOutDate ? new Date(checkOutDate) : new Date(Date.now() + 86400000);

    // Calculate Nights & Financials
    const diffTime = Math.abs(cOutDate.getTime() - cInDate.getTime());
    const numberOfNights = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

    const pricePerNight = room.customPricePerNight || (room.roomType as any)?.basePrice || 2500;
    const baseAmount = pricePerNight * numberOfNights;
    const taxRate = req.hotel?.settings?.taxPercentage ?? 0;
    const taxAmount = Math.round((baseAmount * taxRate) / 100);
    const totalAmount = baseAmount + taxAmount - Number(discountAmount);
    const advancePaid = Number(advancePaymentAmount) || 0;
    const dueAmount = Math.max(0, totalAmount - advancePaid);

    // Booking Reference Number
    const bookingNumber = `BK-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    const booking = await Booking.create({
      hotel: req.hotelId,
      bookingNumber,
      guest: guest._id,
      room: room._id,
      roomType: room.roomType?._id || room.roomType,
      createdBy: req.user?._id,
      checkInDate: cInDate,
      checkOutDate: cOutDate,
      actualCheckIn: isInstantCheckIn ? new Date() : undefined,
      numberOfNights,
      guestsCount: { adults, children },
      baseAmount,
      taxAmount,
      discountAmount: Number(discountAmount),
      extraChargesTotal: 0,
      totalAmount,
      paidAmount: advancePaid,
      dueAmount,
      status: isInstantCheckIn ? 'CHECKED_IN' : 'CONFIRMED',
      specialRequests,
    });

    // If checked in, set room to OCCUPIED
    if (isInstantCheckIn) {
      room.status = 'OCCUPIED';
      await room.save();
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
        action: isInstantCheckIn ? 'GUEST_CHECKED_IN' : 'BOOKING_CREATED',
        module: 'BOOKINGS',
        entityId: booking.bookingNumber,
        newValue: { guest: guest.fullName, room: room.roomNumber, totalAmount, paid: advancePaid },
      });
    }

    // Real-Time Multi-Tenant Socket Broadcasts
    emitToHotel(req.hotelId, 'BOOKING_CREATED', {
      bookingId: booking._id,
      bookingNumber: booking.bookingNumber,
      guestName: guest.fullName,
      roomNumber: room.roomNumber,
      status: booking.status,
      totalAmount,
      paidAmount: advancePaid,
    });
    emitToHotel(req.hotelId, 'ROOM_UPDATED', {
      roomId: room._id,
      roomNumber: room.roomNumber,
      status: isInstantCheckIn ? 'OCCUPIED' : room.status,
      guestName: isInstantCheckIn ? guest.fullName : undefined,
    });
    emitToHotel(req.hotelId, 'DASHBOARD_SYNC', { type: isInstantCheckIn ? 'CHECK_IN' : 'NEW_BOOKING' });
    if (advancePaid > 0) {
      emitToHotel(req.hotelId, 'PAYMENT_RECORDED', {
        receiptNumber,
        amount: advancePaid,
        method: cleanPaymentMethod,
        bookingNumber: booking.bookingNumber,
      });
    }

    res.status(201).json({
      success: true,
      message: isInstantCheckIn
        ? `Guest ${guest.fullName} checked in to Room ${room.roomNumber} successfully!`
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
    const { settlementPaymentAmount = 0, paymentMethod = 'CASH' } = req.body;

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

    const paidNow = Number(settlementPaymentAmount) || 0;
    booking.paidAmount += paidNow;
    booking.dueAmount = Math.max(0, booking.totalAmount - booking.paidAmount);
    booking.status = 'CHECKED_OUT';
    booking.actualCheckOut = new Date();
    await booking.save();

    // Mark Room for CLEANING with 15-minute housekeeping turnaround timer
    const room = await Room.findById(booking.room);
    if (room) {
      room.status = 'CLEANING';
      room.cleaningStartedAt = new Date();
      room.cleaningDurationMinutes = 15;
      await room.save();
    }

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
        note: req.body.note || 'Settlement at checkout',
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
      .populate('room', 'roomNumber floor status')
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

      if (activeBooking) {
        if (activeBooking.status === 'CHECKED_IN') stayStatus = 'IN-HOUSE';
        else if (activeBooking.status === 'CONFIRMED') stayStatus = 'RESERVED';
        else if (activeBooking.status === 'CHECKED_OUT') stayStatus = 'CHECKED_OUT';
        else if (activeBooking.status === 'CANCELLED') stayStatus = 'CANCELLED';

        const r = activeBooking.room as any;
        if (r?.roomNumber) {
          roomNumber = String(r.roomNumber);
        }
        if (activeBooking.checkInDate) {
          checkInStr = new Date(activeBooking.checkInDate).toLocaleDateString('en-IN');
        }
        if (activeBooking.checkOutDate) {
          checkOutStr = new Date(activeBooking.checkOutDate).toLocaleDateString('en-IN');
        }
      }

      return {
        ...gObj,
        name: gObj.fullName,
        phone: gObj.mobileNumber,
        status: stayStatus,
        roomAssigned: roomNumber,
        roomNumber: roomNumber,
        checkInDate: checkInStr,
        checkOutDate: checkOutStr,
        totalVisits: guestBookings.length || 1,
        activeBookingNumber: activeBooking?.bookingNumber || 'N/A',
        dueAmount: activeBooking?.dueAmount || 0,
        totalAmount: activeBooking?.totalAmount || 0,
        idType: gObj.idProof?.idType || 'AADHAAR',
        idNumber: gObj.idProof?.idNumber || 'N/A',
        govtIdType: gObj.idProof?.idType || 'AADHAAR',
        govtIdNumber: gObj.idProof?.idNumber || 'N/A',
        idVerified: gObj.idProof?.verificationStatus === 'VERIFIED',
      };
    });

    const total = formattedGuests.length;
    let finalGuests = formattedGuests;

    if (limit && Number(limit) > 0) {
      const pageNum = Number(page) || 1;
      const limitNum = Number(limit);
      finalGuests = formattedGuests.slice((pageNum - 1) * limitNum, (pageNum - 1) * limitNum + limitNum);
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
              govtIdType: guestObj.idProof?.idType || 'AADHAAR',
              govtIdNumber: guestObj.idProof?.idNumber || '',
            }
          : { name: 'Guest', phone: '', email: '' },
        roomNumber: roomObj ? roomObj.roomNumber : 'N/A',
        checkInDate: bObj.checkInDate ? new Date(bObj.checkInDate).toISOString().split('T')[0] : '',
        checkOutDate: bObj.checkOutDate ? new Date(bObj.checkOutDate).toISOString().split('T')[0] : '',
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
      res.status(404).json({ success: false, isRepeatGuest: false, message: 'No prior guest profile found.' });
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
      updatedGuest.idProof = {
        idType: result.data.idType,
        idNumber: result.data.idNumber,
        frontImage: frontImage || updatedGuest.idProof?.frontImage || '',
        backImage: backImage || updatedGuest.idProof?.backImage || '',
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


