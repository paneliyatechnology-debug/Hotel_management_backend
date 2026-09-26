import { Response } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import Hotel from '../models/Hotel';
import User from '../models/User';
import Room from '../models/Room';
import RoomType from '../models/RoomType';
import Booking from '../models/Booking';
import Guest from '../models/Guest';
import Payment from '../models/Payment';
import CashHandover from '../models/CashHandover';
import AuditLog from '../models/AuditLog';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import sendEmail from '../utils/sendEmail';
import logAuditAction from '../utils/auditLogger';
import { receptionistCredentialsEmailTemplate } from '../utils/emailTemplates';
import { computeSubscriptionMetrics } from './authController';
import { emitToHotel } from '../utils/socketService';

// @desc    Hotel Admin Dashboard KPI Summary
// @route   GET /api/v1/admin/dashboard
export const getHotelAdminDashboard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const hotelId = req.hotelId || req.user?.hotel;
    if (!hotelId) {
      res.status(400).json({ success: false, message: 'Hotel context missing' });
      return;
    }
    const hotelObjId = new mongoose.Types.ObjectId(hotelId.toString());

    // Room Status Counts
    const availableRooms = await Room.countDocuments({ hotel: hotelId, status: 'AVAILABLE', isActive: true });
    const occupiedRooms = await Room.countDocuments({ hotel: hotelId, status: 'OCCUPIED', isActive: true });
    const reservedRooms = await Room.countDocuments({ hotel: hotelId, status: 'RESERVED', isActive: true });
    const cleaningRooms = await Room.countDocuments({ hotel: hotelId, status: 'CLEANING', isActive: true });
    const maintenanceRooms = await Room.countDocuments({ hotel: hotelId, status: 'MAINTENANCE', isActive: true });
    const totalRooms = await Room.countDocuments({ hotel: hotelId, isActive: true });

    // Today's Start & End
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // Today Check-ins & Check-outs
    const todayCheckIns = await Booking.countDocuments({
      hotel: hotelId,
      checkInDate: { $gte: startOfToday, $lte: endOfToday },
    });
    const todayCheckOuts = await Booking.countDocuments({
      hotel: hotelId,
      checkOutDate: { $gte: startOfToday, $lte: endOfToday },
    });

    // Active Guests Currently Staying
    const currentGuests = await Booking.countDocuments({
      hotel: hotelId,
      status: 'CHECKED_IN',
    });

    // Revenue Metrics - Today
    const todayPayments = await Payment.aggregate([
      { $match: { hotel: hotelObjId, paymentStatus: 'PAID', createdAt: { $gte: startOfToday, $lte: endOfToday } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const todayRevenue = todayPayments.length > 0 ? todayPayments[0].total : 0;
    const todayEarnings = Math.round(todayRevenue * 0.785);

    // Revenue Metrics - Yesterday
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const endOfYesterday = new Date(endOfToday);
    endOfYesterday.setDate(endOfYesterday.getDate() - 1);

    const yesterdayPayments = await Payment.aggregate([
      { $match: { hotel: hotelObjId, paymentStatus: 'PAID', createdAt: { $gte: startOfYesterday, $lte: endOfYesterday } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const yesterdayRevenue = yesterdayPayments.length > 0 ? yesterdayPayments[0].total : 0;
    const dayGrowthRate = yesterdayRevenue > 0
      ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100)
      : todayRevenue > 0 ? 100 : 0;

    // Month's Start
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const monthlyPayments = await Payment.aggregate([
      { $match: { hotel: hotelObjId, paymentStatus: 'PAID', createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const monthlyRevenue = monthlyPayments.length > 0 ? monthlyPayments[0].total : 0;

    // Total Pending Dues
    const pendingDuesSummary = await Booking.aggregate([
      { $match: { hotel: hotelObjId, dueAmount: { $gt: 0 }, status: { $ne: 'CANCELLED' } } },
      { $group: { _id: null, totalDue: { $sum: '$dueAmount' } } },
    ]);
    const pendingPayments = pendingDuesSummary.length > 0 ? pendingDuesSummary[0].totalDue : 0;

    // Recent 5 Bookings
    const recentBookings = await Booking.find({ hotel: hotelId })
      .populate('guest', 'fullName mobileNumber')
      .populate('room', 'roomNumber')
      .sort({ createdAt: -1 })
      .limit(5);

    res.status(200).json({
      success: true,
      data: {
        roomsSummary: {
          total: totalRooms,
          available: availableRooms,
          occupied: occupiedRooms,
          reserved: reservedRooms,
          cleaning: cleaningRooms,
          maintenance: maintenanceRooms,
          occupancyRate: totalRooms > 0 ? `${Math.round((occupiedRooms / totalRooms) * 100)}%` : '0%',
        },
        operationsSummary: {
          todayCheckIns,
          todayCheckOuts,
          currentGuests,
        },
        financials: {
          todayRevenue,
          todayEarnings,
          yesterdayRevenue,
          dayGrowthRate,
          monthlyRevenue,
          pendingPayments,
        },
        recentBookings,
        subscription: computeSubscriptionMetrics(req.hotel) || req.hotel?.subscription,
        supportContact: {
          phone: '+91 98765 43210',
          email: 'support@cloudhotelier.com',
          whatsapp: '+919876543210',
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== ROOM TYPE MANAGEMENT ====================
export const getRoomTypes = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const roomTypes = await RoomType.find({ hotel: req.hotelId, isDeleted: { $ne: true }, isActive: true }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: roomTypes.length, data: roomTypes });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== HOTEL PROFILE & SETTINGS ====================
export const getHotelProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const hotel = await Hotel.findById(req.hotelId);
    if (!hotel) {
      res.status(404).json({ success: false, message: 'Hotel not found.' });
      return;
    }
    const hotelObj = hotel.toObject();
    const liveSub = computeSubscriptionMetrics(hotelObj);
    hotelObj.subscription = liveSub || hotelObj.subscription;
    (hotelObj as any).supportContact = {
      phone: '+91 98765 43210',
      email: 'support@cloudhotelier.com',
      whatsapp: '+919876543210',
    };

    res.status(200).json({ success: true, data: hotelObj });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createRoomType = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, description, basePrice, capacity, bedCount, bedType, amenities, images } = req.body;
    if (!name || !basePrice) {
      res.status(400).json({ success: false, message: 'Room type name and base price are required.' });
      return;
    }

    const roomType = await RoomType.create({
      hotel: req.hotelId,
      name,
      description,
      basePrice,
      capacity: capacity || { adults: 2, children: 1 },
      bedCount: Number(bedCount) || 1,
      bedType: bedType || '1 King Bed',
      amenities: amenities || [],
      images: images || [],
      isActive: true,
      isDeleted: false,
    });

    emitToHotel(req.hotelId, 'DASHBOARD_SYNC', { type: 'ROOM_TYPE_CREATED' });

    res.status(201).json({ success: true, data: roomType });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateRoomType = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, description, basePrice, capacity, bedCount, bedType, amenities, images, isActive } = req.body;
    const roomType = await RoomType.findOne({ _id: req.params.id, hotel: req.hotelId, isDeleted: { $ne: true } });
    if (!roomType) {
      res.status(404).json({ success: false, message: 'Room category not found.' });
      return;
    }

    if (name) roomType.name = name;
    if (description !== undefined) roomType.description = description;
    if (basePrice !== undefined) roomType.basePrice = Number(basePrice);
    if (capacity) roomType.capacity = { adults: Number(capacity.adults || 2), children: Number(capacity.children || 1) };
    if (bedCount !== undefined) roomType.bedCount = Number(bedCount);
    if (bedType !== undefined) roomType.bedType = bedType;
    if (amenities !== undefined) roomType.amenities = Array.isArray(amenities) ? amenities : [];
    if (images !== undefined) roomType.images = images;
    if (isActive !== undefined) roomType.isActive = Boolean(isActive);

    await roomType.save();

    emitToHotel(req.hotelId, 'DASHBOARD_SYNC', { type: 'ROOM_TYPE_UPDATED' });

    res.status(200).json({ success: true, message: `Room category '${roomType.name}' updated successfully.`, data: roomType });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getRooms = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { status, roomType, search, page, limit } = req.query;
    const query: any = { hotel: req.hotelId, isDeleted: { $ne: true }, isActive: true };

    if (status && status !== 'ALL') query.status = status;
    if (roomType) query.roomType = roomType;
    if (search) query.roomNumber = { $regex: search, $options: 'i' };

    const total = await Room.countDocuments(query);
    let roomQuery = Room.find(query).populate('roomType').sort({ roomNumber: 1 });

    if (limit && Number(limit) > 0) {
      const pageNum = Number(page) || 1;
      const limitNum = Number(limit);
      roomQuery = roomQuery.skip((pageNum - 1) * limitNum).limit(limitNum);
    }

    const rooms = await roomQuery;
    res.status(200).json({
      success: true,
      total,
      count: rooms.length,
      page: Number(page) || 1,
      totalPages: limit && Number(limit) > 0 ? Math.ceil(total / Number(limit)) : 1,
      data: rooms,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createRoom = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { roomNumber, roomType, floor, seatingCapacity, bedCount, bedType, customPricePerNight, notes, amenities, status } = req.body;
    if (!roomNumber || !roomType) {
      res.status(400).json({ success: false, message: 'Room number and room category are required.' });
      return;
    }

    const existingRoom = await Room.findOne({ hotel: req.hotelId, roomNumber: roomNumber.toString().trim() });
    if (existingRoom && !existingRoom.isDeleted) {
      res.status(400).json({ success: false, message: `Room ${roomNumber} already exists in this hotel.` });
      return;
    }

    let room;
    if (existingRoom && existingRoom.isDeleted) {
      existingRoom.roomType = roomType;
      existingRoom.floor = Number(floor) || 1;
      existingRoom.seatingCapacity = Number(seatingCapacity) || 2;
      existingRoom.bedCount = Number(bedCount) || 1;
      existingRoom.bedType = bedType || '1 King Bed';
      existingRoom.status = status || 'AVAILABLE';
      existingRoom.customPricePerNight = customPricePerNight ? Number(customPricePerNight) : undefined;
      existingRoom.notes = notes || '';
      existingRoom.amenities = Array.isArray(amenities) ? amenities : [];
      existingRoom.isActive = true;
      existingRoom.isDeleted = false;
      await existingRoom.save();
      room = existingRoom;
    } else {
      room = await Room.create({
        hotel: req.hotelId,
        roomNumber: roomNumber.toString().trim(),
        roomType,
        floor: Number(floor) || 1,
        seatingCapacity: Number(seatingCapacity) || 2,
        bedCount: Number(bedCount) || 1,
        bedType: bedType || '1 King Bed',
        status: status || 'AVAILABLE',
        customPricePerNight: customPricePerNight ? Number(customPricePerNight) : undefined,
        notes: notes || '',
        amenities: Array.isArray(amenities) ? amenities : [],
        isActive: true,
        isDeleted: false,
      });
    }

    const populatedRoom = await Room.findById(room._id).populate('roomType');

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: 'ROOM_CREATED',
        module: 'ROOMS',
        entityId: room.roomNumber,
      });
    }

    emitToHotel(req.hotelId, 'ROOM_UPDATED', { roomId: room._id, roomNumber: room.roomNumber, status: room.status });
    emitToHotel(req.hotelId, 'DASHBOARD_SYNC', { type: 'ROOM_CREATED' });

    res.status(201).json({ success: true, message: `Room ${room.roomNumber} created successfully.`, data: populatedRoom || room });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateRoom = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { roomNumber, roomType, floor, seatingCapacity, bedCount, bedType, customPricePerNight, notes, amenities, status } = req.body;
    const room = await Room.findOne({ _id: req.params.id, hotel: req.hotelId, isDeleted: { $ne: true } });
    if (!room) {
      res.status(404).json({ success: false, message: 'Room not found.' });
      return;
    }

    if (roomNumber && roomNumber.toString().trim() !== room.roomNumber) {
      const duplicate = await Room.findOne({ hotel: req.hotelId, roomNumber: roomNumber.toString().trim(), _id: { $ne: room._id }, isDeleted: { $ne: true } });
      if (duplicate) {
        res.status(400).json({ success: false, message: `Room number ${roomNumber} is already in use.` });
        return;
      }
      room.roomNumber = roomNumber.toString().trim();
    }

    if (roomType) room.roomType = roomType;
    if (floor !== undefined) room.floor = Number(floor);
    if (seatingCapacity !== undefined) room.seatingCapacity = Number(seatingCapacity);
    if (bedCount !== undefined) room.bedCount = Number(bedCount);
    if (bedType !== undefined) room.bedType = bedType;
    if (customPricePerNight !== undefined) room.customPricePerNight = customPricePerNight ? Number(customPricePerNight) : undefined;
    if (notes !== undefined) room.notes = notes;
    if (amenities !== undefined) room.amenities = Array.isArray(amenities) ? amenities : [];
    if (status) room.status = status;

    await room.save();
    const populatedRoom = await Room.findById(room._id).populate('roomType');

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: 'ROOM_UPDATED',
        module: 'ROOMS',
        entityId: room.roomNumber,
      });
    }

    emitToHotel(req.hotelId, 'ROOM_UPDATED', { roomId: room._id, roomNumber: room.roomNumber, status: room.status, customPrice: room.customPricePerNight });
    emitToHotel(req.hotelId, 'DASHBOARD_SYNC', { type: 'ROOM_UPDATED' });

    res.status(200).json({ success: true, message: `Room ${room.roomNumber} updated successfully.`, data: populatedRoom || room });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateRoomStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { status, notes, cleaningDurationMinutes = 15 } = req.body;
    const validStatuses = ['AVAILABLE', 'RESERVED', 'OCCUPIED', 'CLEANING', 'MAINTENANCE', 'BLOCKED'];

    if (!validStatuses.includes(status)) {
      res.status(400).json({ success: false, message: `Status must be one of: ${validStatuses.join(', ')}` });
      return;
    }

    const room = await Room.findOne({ _id: req.params.id, hotel: req.hotelId, isDeleted: { $ne: true } });
    if (!room) {
      res.status(404).json({ success: false, message: 'Room not found.' });
      return;
    }

    const oldStatus = room.status;
    room.status = status;
    if (notes) room.notes = notes;

    if (status === 'CLEANING') {
      room.cleaningStartedAt = new Date();
      room.cleaningDurationMinutes = Number(cleaningDurationMinutes) || 15;
    }

    await room.save();

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: `ROOM_STATUS_CHANGED_${status}`,
        module: 'ROOMS',
        entityId: room.roomNumber,
        oldValue: { status: oldStatus },
        newValue: { status },
      });
    }

    emitToHotel(req.hotelId, 'ROOM_UPDATED', { roomId: room._id, roomNumber: room.roomNumber, status });
    emitToHotel(req.hotelId, 'DASHBOARD_SYNC', { type: 'ROOM_STATUS_CHANGED' });

    res.status(200).json({ success: true, message: `Room ${room.roomNumber} status set to ${status}.`, data: room });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== HOTEL STAFF MANAGEMENT ====================
export const getReceptionists = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { search, role, page, limit } = req.query;
    const query: any = {
      hotel: req.hotelId,
      role: { $in: ['RECEPTIONIST', 'MANAGER', 'HOUSEKEEPING', 'ACCOUNTANT'] },
      isDeleted: { $ne: true },
      status: { $ne: 'DELETED' },
    };

    if (role && role !== 'ALL') {
      query.role = role;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await User.countDocuments(query);
    let staffQuery = User.find(query).select('-password').sort({ createdAt: -1 });

    if (limit && Number(limit) > 0) {
      const pageNum = Number(page) || 1;
      const limitNum = Number(limit);
      staffQuery = staffQuery.skip((pageNum - 1) * limitNum).limit(limitNum);
    }

    const staff = await staffQuery;
    res.status(200).json({
      success: true,
      total,
      count: staff.length,
      page: Number(page) || 1,
      totalPages: limit && Number(limit) > 0 ? Math.ceil(total / Number(limit)) : 1,
      data: staff,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createReceptionist = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, email, phone, employeeId, role } = req.body;
    if (!name || !email) {
      res.status(400).json({ success: false, message: 'Name and email are required for staff member.' });
      return;
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      res.status(400).json({ success: false, message: 'A user with this email already exists.' });
      return;
    }

    // Map and validate staff role from backend UserRole enum
    const validRoles = ['RECEPTIONIST', 'MANAGER', 'HOUSEKEEPING', 'ACCOUNTANT'];
    let assignedRole: any = 'RECEPTIONIST';
    if (role) {
      const normalizedRole = role.toString().trim().toUpperCase();
      if (validRoles.includes(normalizedRole)) {
        assignedRole = normalizedRole;
      } else if (normalizedRole.includes('MANAGER')) {
        assignedRole = 'MANAGER';
      } else if (normalizedRole.includes('HOUSEKEEPING')) {
        assignedRole = 'HOUSEKEEPING';
      } else if (normalizedRole.includes('ACCOUNT') || normalizedRole.includes('CASHIER')) {
        assignedRole = 'ACCOUNTANT';
      }
    }

    const rawTempPassword = assignedRole.slice(0, 4) + '@' + crypto.randomBytes(4).toString('hex') + '#26';

    const staffMember = await User.create({
      name,
      email: email.toLowerCase(),
      phone: phone || '',
      employeeId: employeeId || `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
      password: rawTempPassword,
      role: assignedRole,
      hotel: req.hotelId as any,
      status: 'ACTIVE',
      mustChangePassword: true,
    });

    // Send credentials email
    const loginUrl = process.env.ADMIN_URL || 'https://hotel-management-admin-livid.vercel.app/login';
    try {
      await sendEmail({
        email: staffMember.email,
        subject: `Staff Login Credentials (${assignedRole}) - ${req.hotel?.name || 'Hotel'}`,
        html: receptionistCredentialsEmailTemplate({
          hotelName: req.hotel?.name || 'The Hotel',
          receptionistName: staffMember.name,
          email: staffMember.email,
          temporaryPassword: rawTempPassword,
          employeeId: staffMember.employeeId,
          loginUrl,
        }),
      });
    } catch (err: any) {
      console.warn('Staff credentials email error:', err.message);
    }

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: `STAFF_MEMBER_CREATED_${assignedRole}`,
        module: 'STAFF',
        entityId: staffMember.email,
      });
    }

    res.status(201).json({
      success: true,
      message: `Staff member ${staffMember.name} (${assignedRole}) onboarded. Login credentials sent to ${staffMember.email}.`,
      data: {
        _id: staffMember._id,
        name: staffMember.name,
        email: staffMember.email,
        phone: staffMember.phone,
        role: staffMember.role,
        employeeId: staffMember.employeeId,
        status: staffMember.status,
        temporaryPassword: rawTempPassword,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateReceptionist = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, phone, role, email, shift } = req.body;
    const staff = await User.findOne({ _id: req.params.id, hotel: req.hotelId });
    if (!staff) {
      res.status(404).json({ success: false, message: 'Staff member not found in your hotel.' });
      return;
    }

    if (name) staff.name = name;
    if (phone !== undefined) staff.phone = phone;
    if (email) staff.email = email.toLowerCase();
    if (role) {
      const validRoles = ['RECEPTIONIST', 'MANAGER', 'HOUSEKEEPING', 'ACCOUNTANT'];
      const normalizedRole = role.toString().trim().toUpperCase();
      if (validRoles.includes(normalizedRole)) {
        staff.role = normalizedRole as any;
      }
    }

    await staff.save();

    res.status(200).json({
      success: true,
      message: 'Staff details updated successfully.',
      data: {
        _id: staff._id,
        name: staff.name,
        email: staff.email,
        phone: staff.phone,
        role: staff.role,
        employeeId: staff.employeeId,
        status: staff.status,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateReceptionistStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { status } = req.body;
    const staff = await User.findOne({ _id: req.params.id, hotel: req.hotelId });
    if (!staff) {
      res.status(404).json({ success: false, message: 'Staff member not found in your hotel.' });
      return;
    }

    staff.status = status;
    await staff.save();

    res.status(200).json({ success: true, message: `Staff member status updated to ${status}.` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== HOTEL PROFILE & SETTINGS ====================


export const updateHotelProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { address, city, state, pincode, website, logo, settings } = req.body;
    const hotel = await Hotel.findById(req.hotelId);
    if (!hotel) {
      res.status(404).json({ success: false, message: 'Hotel not found.' });
      return;
    }

    if (address !== undefined) hotel.address = address;
    if (city !== undefined) hotel.city = city;
    if (state !== undefined) hotel.state = state;
    if (pincode !== undefined) hotel.pincode = pincode;
    if (website !== undefined) hotel.website = website;
    if (logo !== undefined) hotel.logo = logo;

    if (settings) {
      let checkInTime = settings.checkInTime !== undefined ? String(settings.checkInTime).trim() : (hotel.settings?.checkInTime || '14:00');
      let checkOutTime = settings.checkOutTime !== undefined ? String(settings.checkOutTime).trim() : (hotel.settings?.checkOutTime || '12:00');
      const timezone = settings.timezone !== undefined ? String(settings.timezone).trim() : (hotel.settings?.timezone || 'Asia/Kolkata');

      // Helper to convert "02:00 PM" or "14:00" to "HH:mm"
      const normalizeTime = (t: string): string => {
        const ampmMatch = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
        if (ampmMatch) {
          let hours = parseInt(ampmMatch[1], 10);
          const minutes = ampmMatch[2];
          const period = ampmMatch[3].toUpperCase();
          if (period === 'PM' && hours < 12) hours += 12;
          if (period === 'AM' && hours === 12) hours = 0;
          return `${hours.toString().padStart(2, '0')}:${minutes}`;
        }
        return t;
      };

      checkInTime = normalizeTime(checkInTime);
      checkOutTime = normalizeTime(checkOutTime);

      const time24Regex = /^([01]\d|2[0-3]):([0-5]\d)$/;
      if (!time24Regex.test(checkInTime)) {
        res.status(400).json({
          success: false,
          message: 'Invalid Check-in Time. Please use standard 24-hour (HH:mm, e.g. 14:00) or 12-hour format (e.g. 02:00 PM).',
        });
        return;
      }

      if (!time24Regex.test(checkOutTime)) {
        res.status(400).json({
          success: false,
          message: 'Invalid Check-out Time. Please use standard 24-hour (HH:mm, e.g. 12:00) or 12-hour format (e.g. 12:00 PM).',
        });
        return;
      }

      if (checkInTime === checkOutTime) {
        res.status(400).json({
          success: false,
          message: 'Check-out Time and Check-in Time cannot be identical. Housekeeping requires buffer time between guest stays.',
        });
        return;
      }

      // Turnaround rule validation
      const [inH, inM] = checkInTime.split(':').map(Number);
      const [outH, outM] = checkOutTime.split(':').map(Number);
      const inMinutes = inH * 60 + inM;
      const outMinutes = outH * 60 + outM;

      // In standard hotel PMS operations, checkOut is before checkIn on the turnaround day (e.g. 12:00 checkOut, 14:00 checkIn)
      if (outMinutes > inMinutes && (outMinutes - inMinutes) < 720) {
        res.status(400).json({
          success: false,
          message: 'Invalid timing configuration: Check-out Time must be earlier than Check-in Time to allow room cleaning turnover before incoming guests arrive.',
        });
        return;
      }

      hotel.settings = {
        ...hotel.settings,
        ...settings,
        checkInTime,
        checkOutTime,
        timezone: timezone || 'Asia/Kolkata',
      };
    }

    await hotel.save();

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: 'UPDATE_HOTEL_SETTINGS',
        module: 'HOTEL_PROFILE',
        entityId: hotel.name,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Hotel timings & settings saved successfully.',
      data: hotel,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== HOTEL REVENUE & REPORTS ====================
export const getHotelReports = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    const matchQuery: any = { hotel: req.user?.hotel, paymentStatus: 'PAID' };

    if (startDate && endDate) {
      matchQuery.createdAt = {
        $gte: new Date(startDate as string),
        $lte: new Date(endDate as string),
      };
    }

    // Payment method breakdown (Cash vs Online)
    const paymentMethodStats = await Payment.aggregate([
      { $match: matchQuery },
      { $group: { _id: '$paymentMethod', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);

    // Room Occupancy & Booking counts
    const bookingsCount = await Booking.countDocuments({ hotel: req.hotelId });
    const totalPaymentsSum = await Payment.aggregate([
      { $match: matchQuery },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalRevenue: totalPaymentsSum.length > 0 ? totalPaymentsSum[0].total : 0,
        bookingsCount,
        paymentBreakdown: paymentMethodStats,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteRoomType = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const isPermanent = req.query.permanent === 'true' || req.body?.permanent === true;
    const roomType = await RoomType.findOne({ _id: req.params.id, hotel: req.hotelId });
    if (!roomType) {
      res.status(404).json({ success: false, message: 'Room type not found.' });
      return;
    }

    // 🔒 Check all active non-deleted rooms belonging to this category
    const activeRooms = await Room.find({ hotel: req.hotelId, roomType: roomType._id, isDeleted: { $ne: true } });
    
    // Check if any room is busy / occupied / cleaning / maintenance / blocked
    const busyRooms = activeRooms.filter((r) => r.status !== 'AVAILABLE');
    if (busyRooms.length > 0) {
      const busyList = busyRooms.map((r) => `Room ${r.roomNumber} (${r.status})`).join(', ');
      res.status(400).json({
        success: false,
        message: `Cannot delete Category '${roomType.name}' because ${busyRooms.length} room(s) are currently not AVAILABLE (${busyList}). Rooms must be available and not booked or under housekeeping/cleaning to delete.`,
      });
      return;
    }

    // Check for any active ongoing bookings for this category
    const activeBooking = await Booking.findOne({
      hotel: req.hotelId,
      roomType: roomType._id,
      status: { $in: ['CHECKED_IN', 'RESERVED', 'CONFIRMED'] },
    });
    if (activeBooking) {
      res.status(400).json({
        success: false,
        message: `Cannot delete Category '${roomType.name}' because active bookings (${activeBooking.status}) exist under this category.`,
      });
      return;
    }

    if (isPermanent) {
      // Data Integrity Check: Prevent hard deletion if rooms or bookings reference this room type
      const linkedRoomsCount = activeRooms.length;
      const linkedBookingsCount = await Booking.countDocuments({ hotel: req.hotelId, roomType: roomType._id });

      if (linkedRoomsCount > 0 || linkedBookingsCount > 0) {
        res.status(400).json({
          success: false,
          message: `Cannot permanently delete '${roomType.name}' because it has ${linkedRoomsCount} active rooms and ${linkedBookingsCount} linked bookings. Please use soft delete to preserve historical integrity.`,
        });
        return;
      }

      await RoomType.findByIdAndDelete(roomType._id);
      res.status(200).json({ success: true, message: `Room category '${roomType.name}' permanently deleted.` });
    } else {
      // Default: Safe Soft Delete
      roomType.isActive = false;
      roomType.isDeleted = true;
      await roomType.save();
      res.status(200).json({ success: true, message: `Room category '${roomType.name}' soft-deleted (archived). Historical records preserved.` });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteRoom = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const isPermanent = req.query.permanent === 'true' || req.body?.permanent === true;
    const room = await Room.findOne({ _id: req.params.id, hotel: req.hotelId });
    if (!room) {
      res.status(404).json({ success: false, message: 'Room not found.' });
      return;
    }

    // 🔒 STRICT STATUS CHECK: Room must be in AVAILABLE status
    if (room.status !== 'AVAILABLE') {
      let statusDetail: string = room.status;
      if (room.status === 'OCCUPIED') statusDetail = 'OCCUPIED (Guest is currently checked-in)';
      else if (room.status === 'RESERVED') statusDetail = 'RESERVED (Guest booking confirmed)';
      else if (room.status === 'CLEANING') statusDetail = 'CLEANING (Housekeeping turnaround in progress)';
      else if (room.status === 'MAINTENANCE') statusDetail = 'MAINTENANCE (Repair work in progress)';
      else if (room.status === 'BLOCKED') statusDetail = 'BLOCKED (Admin lock)';

      res.status(400).json({
        success: false,
        message: `Cannot delete Room ${room.roomNumber} because it is currently '${statusDetail}'. Only 'AVAILABLE' rooms can be deleted.`,
      });
      return;
    }

    // Check for any active ongoing bookings for this specific room
    const activeBooking = await Booking.findOne({
      hotel: req.hotelId,
      room: room._id,
      status: { $in: ['CHECKED_IN', 'RESERVED', 'CONFIRMED'] },
    });
    if (activeBooking) {
      res.status(400).json({
        success: false,
        message: `Cannot delete Room ${room.roomNumber} because an active booking (${activeBooking.status}) is assigned to it. Please check-out or cancel the booking first.`,
      });
      return;
    }

    if (isPermanent) {
      // Data Integrity Check: Prevent hard deletion if bookings exist for this room
      const linkedBookingsCount = await Booking.countDocuments({ hotel: req.hotelId, room: room._id });
      if (linkedBookingsCount > 0) {
        res.status(400).json({
          success: false,
          message: `Cannot permanently delete Room ${room.roomNumber} because ${linkedBookingsCount} historical booking folios exist. Please use soft delete.`,
        });
        return;
      }

      await Room.findByIdAndDelete(room._id);
      res.status(200).json({ success: true, message: `Room ${room.roomNumber} permanently deleted.` });
    } else {
      // Default: Safe Soft Delete
      room.isActive = false;
      room.isDeleted = true;
      await room.save();
      res.status(200).json({ success: true, message: `Room ${room.roomNumber} soft-deleted (archived). Audit trail preserved.` });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteReceptionist = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const isPermanent = req.query.permanent === 'true' || req.body?.permanent === true;
    const staff = await User.findOne({ _id: req.params.id, hotel: req.hotelId });
    if (!staff) {
      res.status(404).json({ success: false, message: 'Staff member not found.' });
      return;
    }

    if (isPermanent) {
      // Data Integrity Check: Prevent hard deletion if staff created bookings or collected payments
      const createdBookingsCount = await Booking.countDocuments({ hotel: req.hotelId, createdBy: staff._id });
      const collectedPaymentsCount = await Payment.countDocuments({ hotel: req.hotelId, collectedBy: staff._id });

      if (createdBookingsCount > 0 || collectedPaymentsCount > 0) {
        res.status(400).json({
          success: false,
          message: `Cannot permanently delete staff member '${staff.name}' because ${createdBookingsCount} bookings and ${collectedPaymentsCount} payment receipts are attributed to their account. Soft delete was applied.`,
        });
        return;
      }

      await User.findByIdAndDelete(staff._id);
      res.status(200).json({ success: true, message: `Staff member '${staff.name}' permanently deleted.` });
    } else {
      // Default: Safe Soft Delete
      staff.status = 'DELETED';
      staff.isDeleted = true;
      await staff.save();
      res.status(200).json({ success: true, message: `Staff member '${staff.name}' soft-deleted (deactivated). Past audit logs preserved.` });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get Daily Collections, Unsettled Cash Drawer, & Percentage Breakdown
// @route   GET /api/v1/admin/daily-collections
export const getDailyCollectionsReconciliation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const hotelId = req.hotelId || req.user?.hotel;
    if (!hotelId) {
      res.status(400).json({ success: false, message: 'Hotel context missing' });
      return;
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // Pagination & Search parameters
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 10));
    const search = (req.query.search as string || '').trim();
    const filterMethod = (req.query.paymentMethod as string || 'ALL').trim().toUpperCase();

    // Handover History Pagination parameters
    const handoverPage = Math.max(1, parseInt(req.query.handoverPage as string) || 1);
    const handoverLimit = Math.max(1, Math.min(100, parseInt(req.query.handoverLimit as string) || 5));

    // Yesterday
    const startOfYesterday = new Date();
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    startOfYesterday.setHours(0, 0, 0, 0);
    const endOfYesterday = new Date();
    endOfYesterday.setDate(endOfYesterday.getDate() - 1);
    endOfYesterday.setHours(23, 59, 59, 999);

    // Current Month & Last Month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    // Fetch all today payments for global KPI aggregation
    const allTodayPayments = await Payment.find({
      hotel: hotelId,
      paymentStatus: 'PAID',
      createdAt: { $gte: startOfToday, $lte: endOfToday },
    });

    // Calculate Today's Figures (Full Day Total)
    let todayGross = 0;
    let todayCash = 0;
    let todayUpi = 0;
    let todayCard = 0;
    let todayBank = 0;
    let todayOnline = 0;

    allTodayPayments.forEach((p) => {
      const amt = Number(p.amount) || 0;
      todayGross += amt;
      if (p.paymentMethod === 'CASH') todayCash += amt;
      else if (p.paymentMethod === 'UPI') todayUpi += amt;
      else if (p.paymentMethod === 'CARD') todayCard += amt;
      else if (p.paymentMethod === 'BANK_TRANSFER') todayBank += amt;
      else todayOnline += amt;
    });

    // Backend Search & Paginated Query Construction
    const filterQuery: any = {
      hotel: hotelId,
      paymentStatus: 'PAID',
      createdAt: { $gte: startOfToday, $lte: endOfToday },
    };

    if (filterMethod && filterMethod !== 'ALL') {
      filterQuery.paymentMethod = filterMethod;
    }

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      const matchingGuests = await Guest.find({
        hotel: hotelId,
        $or: [{ fullName: searchRegex }, { mobileNumber: searchRegex }],
      }).select('_id');

      const matchingRooms = await Room.find({
        hotel: hotelId,
        roomNumber: searchRegex,
      }).select('_id');

      const matchingBookings = await Booking.find({
        hotel: hotelId,
        $or: [
          { bookingNumber: searchRegex },
          { room: { $in: matchingRooms.map((r) => r._id) } },
          { guest: { $in: matchingGuests.map((g) => g._id) } },
        ],
      }).select('_id');

      filterQuery.$or = [
        { receiptNumber: searchRegex },
        { transactionId: searchRegex },
        { note: searchRegex },
        { guest: { $in: matchingGuests.map((g) => g._id) } },
        { booking: { $in: matchingBookings.map((b) => b._id) } },
      ];
    }

    const totalRecords = await Payment.countDocuments(filterQuery);
    const totalPages = Math.ceil(totalRecords / limit) || 1;

    // Paginated payments from database
    const paginatedPayments = await Payment.find(filterQuery)
      .populate('guest', 'fullName mobileNumber email')
      .populate({
        path: 'booking',
        select: 'bookingNumber room roomType totalAmount paidAmount dueAmount',
        populate: { path: 'room', select: 'roomNumber' },
      })
      .populate('collectedBy', 'name role')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    // Unsettled Cash in Counter Drawer (All unsettled cash regardless of day)
    const unsettledPayments = await Payment.find({
      hotel: hotelId,
      paymentStatus: 'PAID',
      drawerSettlementStatus: { $ne: 'SETTLED_TO_ADMIN' },
    })
      .populate('guest', 'fullName mobileNumber')
      .populate({
        path: 'booking',
        select: 'bookingNumber room',
        populate: { path: 'room', select: 'roomNumber' },
      })
      .populate('collectedBy', 'name role');

    let cashInDrawer = 0;
    let unsettledUpi = 0;
    let unsettledCard = 0;
    let unsettledBank = 0;

    unsettledPayments.forEach((p) => {
      const amt = Number(p.amount) || 0;
      if (p.paymentMethod === 'CASH') cashInDrawer += amt;
      else if (p.paymentMethod === 'UPI') unsettledUpi += amt;
      else if (p.paymentMethod === 'CARD') unsettledCard += amt;
      else if (p.paymentMethod === 'BANK_TRANSFER') unsettledBank += amt;
    });

    const totalUnsettled = cashInDrawer + unsettledUpi + unsettledCard + unsettledBank;
    const hotelObjId = new mongoose.Types.ObjectId(hotelId.toString());

    // Yesterday's Revenue for comparison
    const yesterdayPayments = await Payment.aggregate([
      { $match: { hotel: hotelObjId, paymentStatus: 'PAID', createdAt: { $gte: startOfYesterday, $lte: endOfYesterday } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const yesterdayGross = yesterdayPayments.length > 0 ? yesterdayPayments[0].total : 0;

    // Month's Revenue
    const thisMonthPayments = await Payment.aggregate([
      { $match: { hotel: hotelObjId, paymentStatus: 'PAID', createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const thisMonthGross = thisMonthPayments.length > 0 ? thisMonthPayments[0].total : 0;

    const lastMonthPayments = await Payment.aggregate([
      { $match: { hotel: hotelObjId, paymentStatus: 'PAID', createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const lastMonthGross = lastMonthPayments.length > 0 ? lastMonthPayments[0].total : 0;

    // Daily Benchmark target: e.g. active rooms * 1800 or 15000 min
    const totalActiveRooms = await Room.countDocuments({ hotel: hotelId, isActive: true });
    const dailyTarget = Math.max(15000, totalActiveRooms * 1800);
    const dailyTargetPercentage = Math.min(200, Number(((todayGross / dailyTarget) * 100).toFixed(1)));

    // Day-over-Day Growth %
    const dayGrowthPercentage = yesterdayGross > 0
      ? Number((((todayGross - yesterdayGross) / yesterdayGross) * 100).toFixed(1))
      : todayGross > 0 ? 100 : 0;

    // Month-over-Month Growth %
    const monthGrowthPercentage = lastMonthGross > 0
      ? Number((((thisMonthGross - lastMonthGross) / lastMonthGross) * 100).toFixed(1))
      : thisMonthGross > 0 ? 100 : 0;

    // Percentage Breakdown by Payment Mode
    const cashPercentage = todayGross > 0 ? Number(((todayCash / todayGross) * 100).toFixed(1)) : 0;
    const upiPercentage = todayGross > 0 ? Number(((todayUpi / todayGross) * 100).toFixed(1)) : 0;
    const cardPercentage = todayGross > 0 ? Number(((todayCard / todayGross) * 100).toFixed(1)) : 0;
    const bankPercentage = todayGross > 0 ? Number(((todayBank / todayGross) * 100).toFixed(1)) : 0;

    // Estimated Net Earnings Margin (Hospitality benchmark: ~78.5% margin)
    const netEarningsMarginPercentage = 78.5;
    const todayEstimatedNetEarnings = Math.round((todayGross * netEarningsMarginPercentage) / 100);
    const monthEstimatedNetEarnings = Math.round((thisMonthGross * netEarningsMarginPercentage) / 100);

    // Total Handed Over / Settled in Vault (All-time Settled)
    const vaultSumAgg = await CashHandover.aggregate([
      { $match: { hotel: hotelObjId } },
      { $group: { _id: null, total: { $sum: '$totalSettledAmount' } } },
    ]);
    const totalVaultSettled = vaultSumAgg.length > 0 ? vaultSumAgg[0].total : 0;

    // Handover History Pagination & Queries
    const totalHandoverRecords = await CashHandover.countDocuments({ hotel: hotelId });
    const totalHandoverPages = Math.ceil(totalHandoverRecords / handoverLimit) || 1;

    const paginatedHandoverRecords = await CashHandover.find({ hotel: hotelId })
      .populate('settledByAdmin', 'name email role')
      .sort({ createdAt: -1 })
      .skip((handoverPage - 1) * handoverLimit)
      .limit(handoverLimit);

    // Format paginated today guest payment list
    const guestPaymentsList = paginatedPayments.map((p) => {
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
        drawerSettlementStatus: pObj.drawerSettlementStatus || 'UNSETTLED',
        settledAt: pObj.settledAt,
        transactionId: pObj.transactionId || 'N/A',
        note: pObj.note || '',
        createdAt: pObj.createdAt,
        timeStr: new Date(pObj.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        guestName: guestObj?.fullName || 'Guest',
        guestPhone: guestObj?.mobileNumber || 'N/A',
        roomNumber: roomObj?.roomNumber || 'N/A',
        bookingNumber: bookingObj?.bookingNumber || 'N/A',
        collectedByName: collector?.name || 'Staff',
      };
    });

    res.status(200).json({
      success: true,
      data: {
        telemetry: {
          todayGross,
          todayCash,
          todayUpi,
          todayCard,
          todayBank,
          todayOnline,
          yesterdayGross,
          thisMonthGross,
          lastMonthGross,
          cashInDrawer, // Front desk counter cash (will reset to 0 on handover)
          unsettledUpi,
          unsettledTotal: totalUnsettled,
          totalVaultSettled,
          unsettledCount: unsettledPayments.length,
          todayEstimatedNetEarnings,
          monthEstimatedNetEarnings,
        },
        percentages: {
          cashPercentage,
          upiPercentage,
          cardPercentage,
          bankPercentage,
          dailyTarget,
          dailyTargetPercentage,
          dayGrowthPercentage,
          monthGrowthPercentage,
          netEarningsMarginPercentage,
        },
        guestPaymentsList,
        pagination: {
          page,
          limit,
          totalRecords,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        handoverHistory: paginatedHandoverRecords,
        handoverPagination: {
          page: handoverPage,
          limit: handoverLimit,
          totalRecords: totalHandoverRecords,
          totalPages: totalHandoverPages,
          hasNextPage: handoverPage < totalHandoverPages,
          hasPrevPage: handoverPage > 1,
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Settle / Handover Cash Drawer to Hotel Admin (Resets Front-Desk Counter to ₹0)
// @route   POST /api/v1/admin/daily-collections/handover
export const settleCashDrawerHandover = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const hotelId = req.hotelId;
    const { notes } = req.body;

    // Find all unsettled payments
    const unsettledPayments = await Payment.find({
      hotel: hotelId,
      paymentStatus: 'PAID',
      drawerSettlementStatus: { $ne: 'SETTLED_TO_ADMIN' },
    });

    if (unsettledPayments.length === 0) {
      res.status(400).json({
        success: false,
        message: 'No pending unsettled payments found in the cash drawer. Drawer is already balanced at ₹0.',
      });
      return;
    }

    let cashAmount = 0;
    let upiAmount = 0;
    let cardAmount = 0;
    let bankAmount = 0;
    const settledPaymentIds: any[] = [];

    const now = new Date();

    for (const p of unsettledPayments) {
      const amt = Number(p.amount) || 0;
      if (p.paymentMethod === 'CASH') cashAmount += amt;
      else if (p.paymentMethod === 'UPI') upiAmount += amt;
      else if (p.paymentMethod === 'CARD') cardAmount += amt;
      else if (p.paymentMethod === 'BANK_TRANSFER') bankAmount += amt;

      p.drawerSettlementStatus = 'SETTLED_TO_ADMIN';
      p.settledAt = now;
      p.settledBy = req.user?._id as any;
      await p.save();
      settledPaymentIds.push(p._id);
    }

    const totalSettledAmount = cashAmount + upiAmount + cardAmount + bankAmount;
    const handoverCode = `HND-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    const handoverRecord = await CashHandover.create({
      hotel: hotelId,
      settledByAdmin: req.user?._id,
      handoverCode,
      cashAmount,
      upiAmount,
      cardAmount,
      bankAmount,
      totalSettledAmount,
      paymentsCount: settledPaymentIds.length,
      settledPaymentIds,
      notes: notes || `Admin Cash-Drawer Handover Settlement - ₹${cashAmount.toLocaleString()} Cash Collected into Vault`,
    });

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: 'CASH_DRAWER_SETTLED',
        module: 'PAYMENTS',
        entityId: handoverCode,
        newValue: {
          handoverCode,
          cashSettled: cashAmount,
          totalSettled: totalSettledAmount,
          paymentsSettledCount: settledPaymentIds.length,
          drawerResetBalance: 0,
        },
      });
    }

    res.status(201).json({
      success: true,
      message: `Successfully collected ₹${cashAmount.toLocaleString()} cash from front-desk counter! Counter drawer is now reset to ₹0.`,
      data: {
        handoverRecord,
        handoverCode,
        cashCollected: cashAmount,
        totalSettledAmount,
        newCashInDrawer: 0,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};


