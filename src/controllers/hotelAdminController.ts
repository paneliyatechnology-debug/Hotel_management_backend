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
import { checkEmailExistsGlobally } from '../utils/emailValidator';
import { autoCompleteExpiredCleaningRooms } from '../utils/housekeepingService';
import { emitToHotel } from '../utils/socketService';

import BookingCharge from '../models/BookingCharge';

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

    // 🧹 Auto-complete any expired housekeeping turnaround rooms to AVAILABLE before KPI calculation
    await autoCompleteExpiredCleaningRooms(hotelId);

    // Room Status Counts
    const availableRooms = await Room.countDocuments({ hotel: hotelId, status: 'AVAILABLE', isActive: true, isDeleted: { $ne: true } });
    const occupiedRooms = await Room.countDocuments({ hotel: hotelId, status: 'OCCUPIED', isActive: true, isDeleted: { $ne: true } });
    const reservedRooms = await Room.countDocuments({ hotel: hotelId, status: 'RESERVED', isActive: true, isDeleted: { $ne: true } });
    const cleaningRooms = await Room.countDocuments({ hotel: hotelId, status: 'CLEANING', isActive: true, isDeleted: { $ne: true } });
    const maintenanceRooms = await Room.countDocuments({ hotel: hotelId, status: 'MAINTENANCE', isActive: true, isDeleted: { $ne: true } });
    const totalRooms = await Room.countDocuments({ hotel: hotelId, isActive: true, isDeleted: { $ne: true } });

    // Today's Start & End
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // Today Check-ins & Check-outs
    const todayCheckIns = await Booking.countDocuments({
      hotel: hotelId,
      isDeleted: { $ne: true },
      checkInDate: { $gte: startOfToday, $lte: endOfToday },
    });
    const todayCheckOuts = await Booking.countDocuments({
      hotel: hotelId,
      isDeleted: { $ne: true },
      checkOutDate: { $gte: startOfToday, $lte: endOfToday },
    });

    // Active In-House Guests
    const currentGuests = await Booking.countDocuments({
      hotel: hotelId,
      status: 'CHECKED_IN',
      isDeleted: { $ne: true },
    });

    // Total Bookings
    const totalBookings = await Booking.countDocuments({
      hotel: hotelId,
      isDeleted: { $ne: true },
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

    // Week's Start (Monday 00:00)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diffToMonday = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const mondayDate = new Date(now);
    mondayDate.setDate(diffToMonday);
    mondayDate.setHours(0, 0, 0, 0);

    const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const weeklyRevenueBreakdown: any[] = [];
    let weekRevenue = 0;

    for (let i = 0; i < 7; i++) {
      const dayStart = new Date(mondayDate);
      dayStart.setDate(mondayDate.getDate() + i);
      dayStart.setHours(0, 0, 0, 0);

      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const dayPayments = await Payment.aggregate([
        { $match: { hotel: hotelObjId, paymentStatus: 'PAID', createdAt: { $gte: dayStart, $lte: dayEnd } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);
      const amount = dayPayments.length > 0 ? dayPayments[0].total : 0;
      weekRevenue += amount;

      weeklyRevenueBreakdown.push({
        day: weekDays[i],
        date: dayStart.toISOString().split('T')[0],
        formattedDate: dayStart.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        amount,
      });
    }

    // Month's Start
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const monthlyPayments = await Payment.aggregate([
      { $match: { hotel: hotelObjId, paymentStatus: 'PAID', createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const monthlyRevenue = monthlyPayments.length > 0 ? monthlyPayments[0].total : 0;

    // Total Pending Dues
    const pendingDuesSummary = await Booking.aggregate([
      { $match: { hotel: hotelObjId, dueAmount: { $gt: 0 }, status: { $ne: 'CANCELLED' }, isDeleted: { $ne: true } } },
      { $group: { _id: null, totalDue: { $sum: '$dueAmount' } } },
    ]);
    const pendingPayments = pendingDuesSummary.length > 0 ? pendingDuesSummary[0].totalDue : 0;

    // Revenue Source Breakdown (Actual Database Aggregations)
    const roomBookingPayments = await Payment.aggregate([
      {
        $match: {
          hotel: hotelObjId,
          paymentStatus: 'PAID',
          paymentType: { $in: ['ADVANCE', 'PARTIAL', 'FULL_SETTLEMENT'] },
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const roomBookingRev = roomBookingPayments.length > 0 ? roomBookingPayments[0].total : 0;

    const extraChargesAgg = await BookingCharge.aggregate([
      { $match: { hotel: hotelObjId, type: { $in: ['EXTRA_BED', 'EXTRA_GUEST', 'MINI_BAR', 'DAMAGE'] } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]);
    const extraServicesRev = extraChargesAgg.length > 0 ? extraChargesAgg[0].total : 0;

    const foodChargesAgg = await BookingCharge.aggregate([
      { $match: { hotel: hotelObjId, type: { $in: ['ROOM_SERVICE', 'LAUNDRY'] } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]);
    const foodRestaurantRev = foodChargesAgg.length > 0 ? foodChargesAgg[0].total : 0;

    const otherPayments = await Payment.aggregate([
      {
        $match: {
          hotel: hotelObjId,
          paymentStatus: 'PAID',
          paymentType: 'EXTRA_CHARGE',
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const otherChargesRev = otherPayments.length > 0 ? otherPayments[0].total : 0;
    const totalRevenueAllSources = roomBookingRev + extraServicesRev + foodRestaurantRev + otherChargesRev;

    // Recent 5 Bookings
    const recentBookings = await Booking.find({ hotel: hotelId, isDeleted: { $ne: true } })
      .populate('guest', 'fullName mobileNumber email')
      .populate('room', 'roomNumber customPricePerNight')
      .populate('rooms', 'roomNumber customPricePerNight')
      .populate('roomType', 'name')
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
          totalBookings,
        },
        financials: {
          todayRevenue,
          weekRevenue,
          weeklyRevenue: weekRevenue,
          monthlyRevenue,
          todayEarnings,
          yesterdayRevenue,
          dayGrowthRate,
          pendingPayments,
          totalRevenue: totalRevenueAllSources,
        },
        weeklyRevenue: {
          breakdown: weeklyRevenueBreakdown,
          totalThisWeek: weekRevenue,
        },
        revenueBreakdown: {
          roomBooking: roomBookingRev,
          extraServices: extraServicesRev,
          foodRestaurant: foodRestaurantRev,
          otherCharges: otherChargesRev,
          totalRevenue: totalRevenueAllSources,
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

// @desc    Get Detailed Revenue & Filterable Transaction Table
// @route   GET /api/v1/admin/revenue-details
export const getRevenueDetails = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const hotelId = req.hotelId || req.user?.hotel;
    if (!hotelId) {
      res.status(400).json({ success: false, message: 'Hotel context missing' });
      return;
    }
    const hotelObjId = new mongoose.Types.ObjectId(hotelId.toString());

    const { filter = 'THIS_WEEK', startDate, endDate, search, paymentMethod, room, status, page = 1, limit = 20 } = req.query;

    let rangeStart = new Date();
    let rangeEnd = new Date();
    rangeEnd.setHours(23, 59, 59, 999);

    const now = new Date();
    const dayOfWeek = now.getDay();
    const diffToMonday = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);

    if (filter === 'TODAY') {
      rangeStart.setHours(0, 0, 0, 0);
    } else if (filter === 'THIS_WEEK') {
      const mon = new Date(now);
      mon.setDate(diffToMonday);
      mon.setHours(0, 0, 0, 0);
      rangeStart = mon;
    } else if (filter === 'LAST_WEEK') {
      const lastMon = new Date(now);
      lastMon.setDate(diffToMonday - 7);
      lastMon.setHours(0, 0, 0, 0);
      rangeStart = lastMon;

      const lastSun = new Date(lastMon);
      lastSun.setDate(lastMon.getDate() + 6);
      lastSun.setHours(23, 59, 59, 999);
      rangeEnd = lastSun;
    } else if (filter === 'THIS_MONTH') {
      rangeStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    } else if (filter === 'LAST_MONTH') {
      rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      rangeEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    } else if (filter === 'CUSTOM' && startDate && endDate) {
      rangeStart = new Date(startDate.toString());
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd = new Date(endDate.toString());
      rangeEnd.setHours(23, 59, 59, 999);
    } else {
      const mon = new Date(now);
      mon.setDate(diffToMonday);
      mon.setHours(0, 0, 0, 0);
      rangeStart = mon;
    }

    const matchQuery: any = {
      hotel: hotelObjId,
      createdAt: { $gte: rangeStart, $lte: rangeEnd },
    };

    if (status && status !== 'ALL') {
      matchQuery.paymentStatus = status;
    } else if (!status) {
      matchQuery.paymentStatus = 'PAID';
    }
    if (paymentMethod && paymentMethod !== 'ALL') {
      matchQuery.paymentMethod = paymentMethod;
    }

    const payments = await Payment.find(matchQuery)
      .populate('guest', 'fullName mobileNumber email')
      .populate({
        path: 'booking',
        populate: [
          { path: 'room', select: 'roomNumber customPricePerNight pricePerNight' },
          { path: 'rooms', select: 'roomNumber customPricePerNight pricePerNight' },
          { path: 'roomType', select: 'name' },
        ],
      })
      .sort({ createdAt: -1 });

    let formattedTransactions = payments.map((p: any) => {
      const g = p.guest || {};
      const b = p.booking || {};
      const rList = Array.isArray(b.rooms) && b.rooms.length > 0 ? b.rooms : b.room ? [b.room] : [];
      const roomNum = rList.map((rm: any) => rm.roomNumber).join(', ') || b.roomNumber || 'Room N/A';
      const rType = b.roomType?.name || 'Standard Room';

      let desc = 'Room Booking';
      if (p.paymentType === 'ADVANCE') desc = 'Advance Booking Deposit';
      else if (p.paymentType === 'EXTRA_CHARGE') desc = 'Extra Services / Food Charge';
      else if (p.paymentType === 'PARTIAL') desc = 'Part Payment';
      else if (p.paymentType === 'FULL_SETTLEMENT') desc = 'Full Settlement';
      if (p.note) desc += ` (${p.note})`;

      const taxPortion = b.taxAmount && b.totalAmount ? Math.round((p.amount / b.totalAmount) * b.taxAmount) : 0;
      const basePortion = Math.max(0, p.amount - taxPortion);

      return {
        id: p._id,
        transactionId: p.transactionId || p.receiptNumber,
        receiptNumber: p.receiptNumber,
        date: p.createdAt,
        formattedDate: new Date(p.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        guestName: g.fullName || 'Guest',
        guestMobile: g.mobileNumber || 'N/A',
        guestEmail: g.email || '',
        bookingNumber: b.bookingNumber || 'N/A',
        bookingId: b._id,
        roomNumber: roomNum,
        roomType: rType,
        description: desc,
        paymentMethod: p.paymentMethod || 'UPI',
        amount: basePortion,
        tax: taxPortion,
        total: p.amount,
        status: p.paymentStatus || 'PAID',
      };
    });

    const searchStr = typeof search === 'string' ? search.trim().toLowerCase() : '';
    if (searchStr) {
      formattedTransactions = formattedTransactions.filter((t) =>
        t.guestName.toLowerCase().includes(searchStr) ||
        t.guestMobile.toLowerCase().includes(searchStr) ||
        t.transactionId.toLowerCase().includes(searchStr) ||
        t.bookingNumber.toLowerCase().includes(searchStr) ||
        t.roomNumber.toLowerCase().includes(searchStr)
      );
    }

    if (room && room !== 'ALL') {
      const rStr = String(room);
      formattedTransactions = formattedTransactions.filter((t) => t.roomNumber.includes(rStr));
    }

    const totalRevenue = formattedTransactions.reduce((acc, t) => acc + (t.status === 'PAID' ? t.total : 0), 0);
    const totalTransactions = formattedTransactions.length;

    let roomBookingRev = 0;
    let extraServicesRev = 0;
    let foodRestaurantRev = 0;
    let otherChargesRev = 0;

    formattedTransactions.forEach((t) => {
      const d = t.description.toLowerCase();
      if (d.includes('extra') || d.includes('service') || d.includes('bed')) {
        extraServicesRev += t.total;
      } else if (d.includes('food') || d.includes('restaurant') || d.includes('dining')) {
        foodRestaurantRev += t.total;
      } else if (d.includes('other') || d.includes('laundry')) {
        otherChargesRev += t.total;
      } else {
        roomBookingRev += t.total;
      }
    });

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Number(limit));
    const totalItems = formattedTransactions.length;
    const paginatedTransactions = formattedTransactions.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    res.status(200).json({
      success: true,
      data: {
        dateRange: {
          startDate: rangeStart.toISOString().split('T')[0],
          endDate: rangeEnd.toISOString().split('T')[0],
          label: `${rangeStart.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} - ${rangeEnd.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
        },
        totalRevenue,
        totalTransactions,
        revenueBreakdown: {
          roomBooking: roomBookingRev,
          extraServices: extraServicesRev,
          foodRestaurant: foodRestaurantRev,
          otherCharges: otherChargesRev,
          total: totalRevenue,
        },
        transactions: paginatedTransactions,
        pagination: {
          total: totalItems,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(totalItems / limitNum) || 1,
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
    const { name, description, basePrice, capacity, bedCount, bedType, amenities, images, gstEnabled, gstRate, taxInclusive } = req.body;
    if (!name || !name.trim()) {
      res.status(400).json({ success: false, message: 'Room category name is required.' });
      return;
    }

    const trimmedName = name.trim();
    const existingCategory = await RoomType.findOne({
      hotel: req.hotelId,
      name: { $regex: new RegExp(`^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      isDeleted: { $ne: true },
    });

    if (existingCategory) {
      res.status(400).json({
        success: false,
        message: `A room category named '${trimmedName}' already exists for your hotel. Category names must be unique.`,
      });
      return;
    }

    const rateVal = gstRate !== undefined && gstRate !== null ? Number(gstRate) : 18;
    const roomType = await RoomType.create({
      hotel: req.hotelId,
      name: trimmedName,
      description: description || '',
      basePrice: Number(basePrice) || 0,
      capacity: capacity || { adults: 2, children: 0 },
      bedCount: Number(bedCount) || 1,
      bedType: bedType || '1 King Bed',
      amenities: amenities || [],
      images: images || [],
      gstEnabled: gstEnabled !== undefined ? Boolean(gstEnabled) : true,
      gstRate: rateVal,
      cgstRate: rateVal / 2,
      sgstRate: rateVal / 2,
      taxInclusive: taxInclusive !== undefined ? Boolean(taxInclusive) : false,
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
    const { name, description, basePrice, capacity, bedCount, bedType, amenities, images, isActive, gstEnabled, gstRate, taxInclusive } = req.body;
    const roomType = await RoomType.findOne({ _id: req.params.id, hotel: req.hotelId, isDeleted: { $ne: true } });
    if (!roomType) {
      res.status(404).json({ success: false, message: 'Room category not found.' });
      return;
    }

    if (name && name.trim()) {
      const trimmedName = name.trim();
      if (trimmedName.toLowerCase() !== roomType.name.trim().toLowerCase()) {
        const existingCategory = await RoomType.findOne({
          hotel: req.hotelId,
          _id: { $ne: req.params.id },
          name: { $regex: new RegExp(`^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          isDeleted: { $ne: true },
        });

        if (existingCategory) {
          res.status(400).json({
            success: false,
            message: `A room category named '${trimmedName}' already exists for your hotel. Category names must be unique.`,
          });
          return;
        }
      }
      roomType.name = trimmedName;
    }

    if (description !== undefined) roomType.description = description;
    if (basePrice !== undefined) roomType.basePrice = Number(basePrice);
    if (capacity) roomType.capacity = { adults: Number(capacity.adults || 2), children: Number(capacity.children || 1) };
    if (bedCount !== undefined) roomType.bedCount = Number(bedCount);
    if (bedType !== undefined) roomType.bedType = bedType;
    if (amenities !== undefined) roomType.amenities = Array.isArray(amenities) ? amenities : [];
    if (images !== undefined) roomType.images = images;
    if (gstEnabled !== undefined) roomType.gstEnabled = Boolean(gstEnabled);
    if (gstRate !== undefined) {
      const r = Number(gstRate);
      roomType.gstRate = r;
      roomType.cgstRate = r / 2;
      roomType.sgstRate = r / 2;
    }
    if (taxInclusive !== undefined) roomType.taxInclusive = Boolean(taxInclusive);
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
    // 🧹 Auto-complete any expired housekeeping turnaround rooms to AVAILABLE
    await autoCompleteExpiredCleaningRooms(req.hotelId);

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
    const { roomNumber, roomType, floor, seatingCapacity, bedCount, bedType, customPricePerNight, notes, amenities, status, gstEnabled, gstRate, taxInclusive } = req.body;
    if (!roomNumber || !roomType) {
      res.status(400).json({ success: false, message: 'Room number and room category are required.' });
      return;
    }

    // 🔓 Free Trial Unlimited Rooms Enabled
    const hotel = await Hotel.findById(req.hotelId);

    const targetFloor = Number(floor) || 1;
    const targetRoomNumber = roomNumber.toString().trim();

    const existingRoom = await Room.findOne({
      hotel: req.hotelId,
      floor: targetFloor,
      roomNumber: targetRoomNumber,
    });
    if (existingRoom && !existingRoom.isDeleted) {
      res.status(400).json({ success: false, message: `Room ${targetRoomNumber} already exists on Floor ${targetFloor}.` });
      return;
    }

    const rateVal = gstRate !== undefined && gstRate !== null ? Number(gstRate) : undefined;

    let room;
    if (existingRoom && existingRoom.isDeleted) {
      existingRoom.roomType = roomType;
      existingRoom.floor = targetFloor;
      existingRoom.seatingCapacity = Number(seatingCapacity) || 2;
      existingRoom.bedCount = Number(bedCount) || 1;
      existingRoom.bedType = bedType || '1 King Bed';
      existingRoom.status = status || 'AVAILABLE';
      existingRoom.customPricePerNight = customPricePerNight ? Number(customPricePerNight) : undefined;
      existingRoom.notes = notes || '';
      existingRoom.amenities = Array.isArray(amenities) ? amenities : [];
      if (gstEnabled !== undefined) existingRoom.gstEnabled = Boolean(gstEnabled);
      if (rateVal !== undefined) {
        existingRoom.gstRate = rateVal;
        existingRoom.cgstRate = rateVal / 2;
        existingRoom.sgstRate = rateVal / 2;
      }
      if (taxInclusive !== undefined) existingRoom.taxInclusive = Boolean(taxInclusive);
      existingRoom.isActive = true;
      existingRoom.isDeleted = false;
      await existingRoom.save();
      room = existingRoom;
    } else {
      room = await Room.create({
        hotel: req.hotelId,
        roomNumber: targetRoomNumber,
        roomType,
        floor: targetFloor,
        seatingCapacity: Number(seatingCapacity) || 2,
        bedCount: Number(bedCount) || 1,
        bedType: bedType || '1 King Bed',
        status: status || 'AVAILABLE',
        customPricePerNight: customPricePerNight ? Number(customPricePerNight) : undefined,
        notes: notes || '',
        amenities: Array.isArray(amenities) ? amenities : [],
        gstEnabled: gstEnabled !== undefined ? Boolean(gstEnabled) : undefined,
        gstRate: rateVal,
        cgstRate: rateVal !== undefined ? rateVal / 2 : undefined,
        sgstRate: rateVal !== undefined ? rateVal / 2 : undefined,
        taxInclusive: taxInclusive !== undefined ? Boolean(taxInclusive) : undefined,
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
        entityId: `${room.roomNumber} (Floor ${room.floor})`,
      });
    }

    emitToHotel(req.hotelId, 'ROOM_UPDATED', { roomId: room._id, roomNumber: room.roomNumber, status: room.status });
    emitToHotel(req.hotelId, 'DASHBOARD_SYNC', { type: 'ROOM_CREATED' });

    res.status(201).json({ success: true, message: `Room ${room.roomNumber} on Floor ${room.floor} created successfully.`, data: populatedRoom || room });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateRoom = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { roomNumber, roomType, floor, seatingCapacity, bedCount, bedType, customPricePerNight, notes, amenities, status, gstEnabled, gstRate, taxInclusive } = req.body;
    const room = await Room.findOne({ _id: req.params.id, hotel: req.hotelId, isDeleted: { $ne: true } });
    if (!room) {
      res.status(404).json({ success: false, message: 'Room not found.' });
      return;
    }

    const targetFloor = floor !== undefined ? Number(floor) : room.floor;
    const targetRoomNumber = roomNumber ? roomNumber.toString().trim() : room.roomNumber;

    if (targetRoomNumber !== room.roomNumber || targetFloor !== room.floor) {
      const duplicate = await Room.findOne({
        hotel: req.hotelId,
        floor: targetFloor,
        roomNumber: targetRoomNumber,
        _id: { $ne: room._id },
        isDeleted: { $ne: true },
      });
      if (duplicate) {
        res.status(400).json({ success: false, message: `Room number ${targetRoomNumber} already exists on Floor ${targetFloor}.` });
        return;
      }
      room.roomNumber = targetRoomNumber;
      room.floor = targetFloor;
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
    if (gstEnabled !== undefined) room.gstEnabled = Boolean(gstEnabled);
    if (gstRate !== undefined && gstRate !== null) {
      const r = Number(gstRate);
      room.gstRate = r;
      room.cgstRate = r / 2;
      room.sgstRate = r / 2;
    }
    if (taxInclusive !== undefined) room.taxInclusive = Boolean(taxInclusive);

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
    } else {
      room.cleaningStartedAt = undefined;
    }

    if (oldStatus === 'OCCUPIED' && (status === 'CLEANING' || status === 'AVAILABLE')) {
      const activeBooking = await Booking.findOne({
        hotel: req.hotelId,
        $or: [{ room: room._id }, { rooms: room._id }, { roomNumber: String(room.roomNumber) }],
        status: { $in: ['CHECKED_IN', 'IN-HOUSE'] },
        isDeleted: { $ne: true },
      });
      if (activeBooking) {
        activeBooking.status = 'CHECKED_OUT';
        const actualNow = new Date();
        activeBooking.actualCheckOut = actualNow;
        activeBooking.checkOutDate = actualNow;
        activeBooking.checkOutTime = `${String(actualNow.getHours()).padStart(2, '0')}:${String(actualNow.getMinutes()).padStart(2, '0')}`;
        await activeBooking.save();
        emitToHotel(req.hotelId, 'BOOKING_UPDATED', { bookingId: activeBooking._id, status: 'CHECKED_OUT' });
      }
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

    if (phone) {
      const cleanPhone = phone.toString().replace(/\D/g, '');
      if (cleanPhone.length !== 10) {
        res.status(400).json({ success: false, message: 'Phone number must contain exactly 10 numeric digits.' });
        return;
      }
    }

    const isEmailUsed = await checkEmailExistsGlobally(email);
    if (isEmailUsed) {
      res.status(400).json({ success: false, message: 'This email is already registered in the system (either as a user, guest, or another hotel owner).' });
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

    const cleanPhone = phone ? phone.toString().replace(/\D/g, '') : '';
    const staffMember = await User.create({
      name,
      email: email.toLowerCase(),
      phone: cleanPhone,
      employeeId: employeeId || `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
      password: rawTempPassword,
      role: assignedRole,
      hotel: req.hotelId as any,
      status: 'ACTIVE',
      mustChangePassword: true,
    });

    // Send credentials email
    const loginUrl = process.env.WEB_URL ? `${process.env.WEB_URL}/login` : 'https://myownpms.com/login';
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
    if (phone !== undefined) {
      const cleanPhone = phone ? phone.toString().replace(/\D/g, '') : '';
      if (cleanPhone && cleanPhone.length !== 10) {
        res.status(400).json({ success: false, message: 'Phone number must contain exactly 10 numeric digits.' });
        return;
      }
      staff.phone = cleanPhone;
    }
    if (email && email.toLowerCase() !== staff.email) {
      const isEmailUsed = await checkEmailExistsGlobally(email, staff._id.toString(), 'User');
      if (isEmailUsed) {
        res.status(400).json({ success: false, message: 'This email is already registered in the system (either as a user, guest, or another hotel owner).' });
        return;
      }
      staff.email = email.toLowerCase();
    }
    if (role) {
      const validRoles = ['RECEPTIONIST', 'MANAGER', 'HOUSEKEEPING', 'ACCOUNTANT'];
      const normalizedRole = role.toString().trim().toUpperCase();
      if (validRoles.includes(normalizedRole)) {
        staff.role = normalizedRole as any;
      }
    }

    await staff.save();

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: 'STAFF_MEMBER_UPDATED',
        module: 'STAFF',
        entityId: staff.email,
      });
    }

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
      res.status(404).json({ success: false, message: 'Room category not found.' });
      return;
    }

    // 1. Find all active non-deleted rooms belonging to this category
    const linkedRooms = await Room.find({ hotel: req.hotelId, roomType: roomType._id, isDeleted: { $ne: true } });
    const linkedRoomIds = linkedRooms.map((r) => r._id);
    const linkedRoomNumbers = linkedRooms.map((r) => r.roomNumber);

    // 2. Find any active in-house or confirmed bookings linked to these rooms or category
    const activeBookings = await Booking.find({
      hotel: req.hotelId,
      status: { $in: ['CHECKED_IN', 'RESERVED', 'CONFIRMED'] },
      $or: [
        { roomType: roomType._id },
        { room: { $in: linkedRoomIds } },
        { rooms: { $in: linkedRoomIds } },
        { roomNumber: { $in: linkedRoomNumbers } },
        { roomNumbers: { $in: linkedRoomNumbers } },
      ],
      isDeleted: { $ne: true },
    });

    // 3. Auto Check-Out active resident guests (preserve guest profiles & transaction ledgers in DB)
    const now = new Date();
    for (const b of activeBookings) {
      b.status = 'CHECKED_OUT';
      b.actualCheckOut = now;
      b.checkOutTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      if (!b.checkOutDate || new Date(b.checkOutDate) > now) {
        b.checkOutDate = now;
      }
      if (!b.paymentStatus || b.paymentStatus === 'PENDING') {
        if ((b.dueAmount || 0) <= 0 && (b.paidAmount || 0) > 0) {
          b.paymentStatus = 'PAID';
        } else if ((b.paidAmount || 0) > 0) {
          b.paymentStatus = 'PARTIALLY_PAID';
        }
      }
      b.specialRequests = (b.specialRequests ? b.specialRequests + ' | ' : '') + `Auto-settled & checked-out: Category '${roomType.name}' deleted by admin.`;
      await b.save();
    }

    // 4. Soft-delete / Archive all linked rooms of this category
    if (linkedRoomIds.length > 0) {
      await Room.updateMany(
        { _id: { $in: linkedRoomIds } },
        { $set: { isDeleted: true, isActive: false, status: 'AVAILABLE' } }
      );
    }

    // 5. Soft-delete / Archive the category itself
    if (isPermanent) {
      await RoomType.findByIdAndDelete(roomType._id);
      if (linkedRoomIds.length > 0) {
        await Room.deleteMany({ _id: { $in: linkedRoomIds } });
      }
    } else {
      roomType.isActive = false;
      roomType.isDeleted = true;
      await roomType.save();
    }

    const checkOutNote = activeBookings.length > 0 
      ? ` ${activeBookings.length} resident guest(s) safely checked out with stay & billing history preserved.` 
      : '';

    res.status(200).json({
      success: true,
      message: `Room category '${roomType.name}' and ${linkedRooms.length} associated room(s) deleted successfully.${checkOutNote}`,
      deletedRoomsCount: linkedRooms.length,
      checkedOutBookingsCount: activeBookings.length,
    });
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
    const rawHotelId = req.hotelId || (req.user?.hotel as any)?._id || req.user?.hotel;
    const hotelIdStr = typeof rawHotelId === 'object' && rawHotelId?._id
      ? rawHotelId._id.toString()
      : String(rawHotelId || '');

    if (!hotelIdStr || !mongoose.Types.ObjectId.isValid(hotelIdStr)) {
      res.status(400).json({ success: false, message: 'Hotel context missing or invalid' });
      return;
    }

    const hotelObjId = new mongoose.Types.ObjectId(hotelIdStr);

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
      hotel: hotelObjId,
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
      hotel: hotelObjId,
      paymentStatus: 'PAID',
      createdAt: { $gte: startOfToday, $lte: endOfToday },
    };

    if (filterMethod && filterMethod !== 'ALL') {
      filterQuery.paymentMethod = filterMethod;
    }

    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escapedSearch, 'i');
      const matchingGuests = await Guest.find({
        hotel: hotelObjId,
        $or: [{ fullName: searchRegex }, { mobileNumber: searchRegex }],
      }).select('_id');

      const matchingRooms = await Room.find({
        hotel: hotelObjId,
        roomNumber: searchRegex,
      }).select('_id');

      const matchingBookings = await Booking.find({
        hotel: hotelObjId,
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
      hotel: hotelObjId,
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
    const totalActiveRooms = await Room.countDocuments({ hotel: hotelObjId, isActive: true });
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
    const totalHandoverRecords = await CashHandover.countDocuments({ hotel: hotelObjId });
    const totalHandoverPages = Math.ceil(totalHandoverRecords / handoverLimit) || 1;

    const paginatedHandoverRecords = await CashHandover.find({ hotel: hotelObjId })
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


