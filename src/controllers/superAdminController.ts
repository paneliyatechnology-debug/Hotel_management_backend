import mongoose from 'mongoose';
import { Response } from 'express';
import crypto from 'crypto';
import Hotel from '../models/Hotel';
import User from '../models/User';
import AuditLog from '../models/AuditLog';
import Payment from '../models/Payment';
import SubscriptionPlan from '../models/SubscriptionPlan';
import Guest from '../models/Guest';
import Booking from '../models/Booking';
import Room from '../models/Room';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import logAuditAction from '../utils/auditLogger';
import { emitToHotel, emitToSuperAdmin, emitGlobal } from '../utils/socketService';
import { queueEmail } from '../queues/emailQueue';

// @desc    Super Admin Dashboard Summary & KPI Metrics
// @route   GET /api/v1/super-admin/dashboard
export const getSuperAdminDashboard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const totalHotels = await Hotel.countDocuments({ isDeleted: false });
    const activeHotels = await Hotel.countDocuments({ status: 'ACTIVE', isDeleted: false });
    const pendingHotels = await Hotel.countDocuments({ status: 'PENDING_APPROVAL', isDeleted: false });
    const suspendedHotels = await Hotel.countDocuments({ status: 'SUSPENDED', isDeleted: false });
    const disabledHotels = await Hotel.countDocuments({ status: 'DISABLED', isDeleted: false });
    const expiredHotels = await Hotel.countDocuments({ status: 'EXPIRED', isDeleted: false });
    const trialHotels = await Hotel.countDocuments({ 'subscription.status': 'TRIAL', isDeleted: false });

    // Dates
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const endOfYesterday = new Date(startOfYesterday);
    endOfYesterday.setHours(23, 59, 59, 999);

    const now = new Date();
    const dayOfWeek = now.getDay();
    const diffToMonday = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const startOfWeek = new Date(now.setDate(diffToMonday));
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const startOfLastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    const endOfLastMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 0, 23, 59, 59, 999);

    // Global Multi-Hotel Metrics
    const totalGuests = await Guest.countDocuments({ isDeleted: { $ne: true } });
    const totalBookings = await Booking.countDocuments({ isDeleted: { $ne: true } });
    const totalRooms = await Room.countDocuments({ isDeleted: { $ne: true } });

    const distinctCities = (await Hotel.distinct('city', { isDeleted: false })).filter(Boolean);
    const totalCities = distinctCities.length || (totalHotels > 0 ? 1 : 0);

    const todayCheckIns = await Booking.countDocuments({
      isDeleted: { $ne: true },
      checkInDate: { $gte: startOfToday, $lte: endOfToday },
    });
    const todayCheckOuts = await Booking.countDocuments({
      isDeleted: { $ne: true },
      checkOutDate: { $gte: startOfToday, $lte: endOfToday },
    });

    // Real Payment Aggregations
    const allPaymentsAgg = await Payment.aggregate([
      { $match: { paymentStatus: 'PAID' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const weeklyPaymentsAgg = await Payment.aggregate([
      { $match: { paymentStatus: 'PAID', createdAt: { $gte: startOfWeek } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const monthlyPaymentsAgg = await Payment.aggregate([
      { $match: { paymentStatus: 'PAID', createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const lastMonthPaymentsAgg = await Payment.aggregate([
      { $match: { paymentStatus: 'PAID', createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const todayPaymentsAgg = await Payment.aggregate([
      { $match: { paymentStatus: 'PAID', createdAt: { $gte: startOfToday, $lte: endOfToday } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const yesterdayPaymentsAgg = await Payment.aggregate([
      { $match: { paymentStatus: 'PAID', createdAt: { $gte: startOfYesterday, $lte: endOfYesterday } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const totalRevenue = allPaymentsAgg.length > 0 ? allPaymentsAgg[0].total : 0;
    const weeklyRevenue = weeklyPaymentsAgg.length > 0 ? weeklyPaymentsAgg[0].total : 0;
    const monthlyRevenue = monthlyPaymentsAgg.length > 0 ? monthlyPaymentsAgg[0].total : 0;
    const lastMonthRevenue = lastMonthPaymentsAgg.length > 0 ? lastMonthPaymentsAgg[0].total : 0;
    const todayRevenue = todayPaymentsAgg.length > 0 ? todayPaymentsAgg[0].total : 0;
    const yesterdayRevenue = yesterdayPaymentsAgg.length > 0 ? yesterdayPaymentsAgg[0].total : 0;

    // Real orders count
    const paidOrdersCount = await Payment.countDocuments({ paymentStatus: 'PAID' });
    const totalOrders = paidOrdersCount || totalBookings || 0;

    // Calculate dynamic growth percentages from real data
    const calcGrowth = (current: number, previous: number): string => {
      if (previous === 0 && current === 0) return '0%';
      if (previous === 0) return '+100%';
      const diff = ((current - previous) / previous) * 100;
      return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
    };

    const todayGrowth = calcGrowth(todayRevenue, yesterdayRevenue);
    const monthlyGrowth = calcGrowth(monthlyRevenue, lastMonthRevenue);

    // Total Pending Dues Across Hotels
    const pendingDuesSummary = await Booking.aggregate([
      { $match: { dueAmount: { $gt: 0 }, status: { $ne: 'CANCELLED' }, isDeleted: { $ne: true } } },
      { $group: { _id: null, totalDue: { $sum: '$dueAmount' } } },
    ]);
    const pendingPayments = pendingDuesSummary.length > 0 ? pendingDuesSummary[0].totalDue : 0;

    // Active Subscriptions
    const activeSubscriptions = await Hotel.countDocuments({
      isDeleted: false,
      'subscription.status': 'ACTIVE',
    });

    const recentPending = await Hotel.find({ status: 'PENDING_APPROVAL', isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(5);

    // Recent 10 Real Transactions from Database
    const recentPayments = await Payment.find({ paymentStatus: 'PAID' })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('hotel', 'name city')
      .populate('guest', 'name phone email')
      .lean();

    res.status(200).json({
      success: true,
      data: {
        totalHotels,
        activeHotels,
        pendingHotels,
        suspendedHotels,
        disabledHotels,
        expiredHotels,
        trialHotels,
        activeSubscriptions,
        totalGuests,
        totalBookings,
        totalRooms,
        totalCities,
        citiesList: distinctCities,
        todayCheckIns,
        todayCheckOuts,
        totalRevenue,
        weeklyRevenue,
        monthlyRevenue,
        todayRevenue,
        yesterdayRevenue,
        todayGrowth,
        monthlyGrowth,
        totalOrders,
        pendingPayments,
        recentPending,
        recentPayments: recentPayments || [],
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get All Hotels with Search, Filter & Pagination
// @route   GET /api/v1/super-admin/hotels
export const getAllHotels = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { status, subscriptionStatus, search, page = 1, limit = 20 } = req.query;
    const query: any = { isDeleted: false };

    if (status && status !== 'ALL') query.status = status;
    if (subscriptionStatus && subscriptionStatus !== 'ALL') query['subscription.status'] = subscriptionStatus;

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { ownerName: { $regex: search, $options: 'i' } },
        { ownerEmail: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const total = await Hotel.countDocuments(query);
    const hotels = await Hotel.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit));

    const enrichedHotels = await Promise.all(
      hotels.map(async (hotel) => {
        const hObj = hotel.toObject();
        const [adminUser, realRoomCount, staffCount] = await Promise.all([
          User.findOne({
            $or: [
              { hotel: hotel._id, role: { $in: ['HOTEL_ADMIN', 'HOTEL_OWNER'] } },
              { email: hotel.ownerEmail.toLowerCase() },
            ],
          }).select('name email phone role').lean(),
          Room.countDocuments({ hotel: hotel._id, isDeleted: { $ne: true } }),
          User.countDocuments({ hotel: hotel._id }),
        ]);

        const adminInfo = adminUser
          ? { name: adminUser.name || hObj.ownerName, email: adminUser.email || hObj.ownerEmail, phone: adminUser.phone || hObj.ownerPhone }
          : { name: hObj.ownerName, email: hObj.ownerEmail, phone: hObj.ownerPhone };

        return {
          ...hObj,
          admin: adminInfo,
          totalRooms: realRoomCount > 0 ? realRoomCount : (hObj.totalRooms || 0),
          staffCount: staffCount || 0,
          phone: hObj.ownerPhone || adminUser?.phone || '',
          taxId: hObj.gstNumber || hObj.settings?.gstin || hObj.panNumber || 'N/A',
          code: hObj.slug ? hObj.slug.toUpperCase() : (hObj.name ? hObj.name.slice(0, 3).toUpperCase() : 'PMS'),
        };
      })
    );

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      data: enrichedHotels,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get Single Hotel Details with Staff & Stats
// @route   GET /api/v1/super-admin/hotels/:id
export const getHotelDetails = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const hotel = await Hotel.findById(req.params.id);
    if (!hotel) {
      res.status(404).json({ success: false, message: 'Hotel not found' });
      return;
    }

    const [staff, totalRooms, totalBookings, totalGuests, paymentsAgg, adminUser] = await Promise.all([
      User.find({ hotel: hotel._id }).select('-password'),
      Room.countDocuments({ hotel: hotel._id, isDeleted: { $ne: true } }),
      Booking.countDocuments({ hotel: hotel._id, isDeleted: { $ne: true } }),
      Guest.countDocuments({ hotel: hotel._id, isDeleted: { $ne: true } }),
      Payment.aggregate([
        { $match: { hotel: hotel._id, paymentStatus: 'PAID' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      User.findOne({
        $or: [
          { hotel: hotel._id, role: { $in: ['HOTEL_ADMIN', 'HOTEL_OWNER'] } },
          { email: hotel.ownerEmail.toLowerCase() },
        ],
      }).select('-password'),
    ]);

    const totalRevenue = paymentsAgg.length > 0 ? paymentsAgg[0].total : 0;
    const hObj = hotel.toObject();

    res.status(200).json({
      success: true,
      data: {
        hotel: {
          ...hObj,
          admin: adminUser
            ? { name: adminUser.name || hObj.ownerName, email: adminUser.email || hObj.ownerEmail, phone: adminUser.phone || hObj.ownerPhone }
            : { name: hObj.ownerName, email: hObj.ownerEmail, phone: hObj.ownerPhone },
          totalRooms: totalRooms > 0 ? totalRooms : (hObj.totalRooms || 0),
          staffCount: staff.length,
          phone: hObj.ownerPhone || adminUser?.phone || '',
          taxId: hObj.gstNumber || hObj.settings?.gstin || hObj.panNumber || 'N/A',
          code: hObj.slug ? hObj.slug.toUpperCase() : (hObj.name ? hObj.name.slice(0, 3).toUpperCase() : 'PMS'),
        },
        staff,
        stats: {
          totalRooms: totalRooms > 0 ? totalRooms : (hObj.totalRooms || 0),
          totalBookings,
          totalGuests,
          totalRevenue,
          staffCount: staff.length,
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Approve Hotel -> Create Hotel Admin Account -> Start 30-Day Trial -> Email Credentials
// @route   PUT /api/v1/super-admin/hotels/:id/approve
export const approveHotel = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const hotel = await Hotel.findById(req.params.id);
    if (!hotel) {
      res.status(404).json({ success: false, message: 'Hotel not found' });
      return;
    }

    if (hotel.status === 'ACTIVE') {
      res.status(400).json({ success: false, message: 'Hotel is already active and approved.' });
      return;
    }

    const trialStart = new Date();
    const trialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    hotel.status = 'ACTIVE';
    hotel.subscription = {
      plan: 'TRIAL',
      status: 'TRIAL',
      trialStartDate: trialStart,
      trialEndDate: trialEnd,
      autoRenew: false,
    };
    await hotel.save();

    const rawTempPassword = 'Adm@' + crypto.randomBytes(4).toString('hex') + '#26';

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

    const loginUrl = process.env.WEB_URL ? `${process.env.WEB_URL}/login` : 'https://myownpms.com/login';
    await queueEmail('HOTEL_APPROVED', hotel.ownerEmail, {
      hotelName: hotel.name,
      ownerName: hotel.ownerName,
      adminEmail: hotel.ownerEmail,
      temporaryPassword: rawTempPassword,
      loginUrl,
      trialStartDate: trialStart.toLocaleDateString('en-IN'),
      trialEndDate: trialEnd.toLocaleDateString('en-IN'),
    });

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: 'HOTEL_APPROVED',
        module: 'HOTELS',
        hotelId: hotel._id,
        entityId: hotel._id.toString(),
        newValue: { status: 'ACTIVE', trialEnd },
      });
    }

    // ⚡ Socket.IO Realtime Broadcasts
    emitToHotel(hotel._id, 'HOTEL_STATUS_UPDATED', { hotel });
    emitToSuperAdmin('HOTEL_STATUS_UPDATED', { hotel });

    res.status(200).json({
      success: true,
      message: `Hotel '${hotel.name}' approved successfully. Hotel Admin account created and credentials emailed.`,
      data: {
        hotelId: hotel._id,
        status: hotel.status,
        adminEmail: hotel.ownerEmail,
        temporaryPassword: rawTempPassword,
        trialEndDate: trialEnd,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Reject Hotel Application
// @route   PUT /api/v1/super-admin/hotels/:id/reject
export const rejectHotel = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { reason } = req.body;
    const hotel = await Hotel.findById(req.params.id);
    if (!hotel) {
      res.status(404).json({ success: false, message: 'Hotel not found' });
      return;
    }

    hotel.status = 'REJECTED';
    hotel.rejectionReason = reason || 'Documentation or criteria did not match requirements.';
    await hotel.save();

    await queueEmail('HOTEL_REJECTED', hotel.ownerEmail, {
      hotelName: hotel.name,
      ownerName: hotel.ownerName,
      reason: hotel.rejectionReason || 'Criteria not met',
    });

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: 'HOTEL_REJECTED',
        module: 'HOTELS',
        hotelId: hotel._id,
        newValue: { status: 'REJECTED', reason: hotel.rejectionReason },
      });
    }

    // ⚡ Socket.IO Realtime Broadcasts
    emitToHotel(hotel._id, 'HOTEL_STATUS_UPDATED', { hotel });
    emitToSuperAdmin('HOTEL_STATUS_UPDATED', { hotel });

    res.status(200).json({
      success: true,
      message: `Hotel application for '${hotel.name}' rejected.`,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Change Hotel Status (DISABLE / SUSPEND / ACTIVATE / EXPIRED) with Reason & Email Notification
// @route   PUT /api/v1/super-admin/hotels/:id/status
export const updateHotelStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { status, reason } = req.body;
    const validStatuses = ['ACTIVE', 'SUSPENDED', 'DISABLED', 'EXPIRED'];

    if (!validStatuses.includes(status)) {
      res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
      return;
    }

    if ((status === 'DISABLED' || status === 'SUSPENDED') && !reason) {
      res.status(400).json({
        success: false,
        message: `Please provide a 'reason' explaining why '${status}' action is being taken against this hotel.`,
      });
      return;
    }

    const hotel = await Hotel.findById(req.params.id);
    if (!hotel) {
      res.status(404).json({ success: false, message: 'Hotel not found' });
      return;
    }

    const oldStatus = hotel.status;
    hotel.status = status;
    hotel.statusReason = reason || '';
    await hotel.save();

    // 📧 Queue Email Notification to Hotel Owner with the Exact Reason
    if (status === 'DISABLED' || status === 'SUSPENDED') {
      await queueEmail('HOTEL_STATUS_CHANGED', hotel.ownerEmail, {
        hotelName: hotel.name,
        ownerName: hotel.ownerName,
        status,
        reason: reason || 'Administrative policy compliance.',
      });
    } else if (status === 'ACTIVE' && (oldStatus === 'DISABLED' || oldStatus === 'SUSPENDED')) {
      await queueEmail('HOTEL_STATUS_CHANGED', hotel.ownerEmail, {
        hotelName: hotel.name,
        ownerName: hotel.ownerName,
        status: 'ACTIVE',
      });
    }

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: `HOTEL_STATUS_CHANGED_${status}`,
        module: 'HOTELS',
        hotelId: hotel._id,
        oldValue: { status: oldStatus },
        newValue: { status, reason },
      });
    }

    // ⚡ Socket.IO Realtime Broadcasts
    emitToHotel(hotel._id, 'HOTEL_STATUS_UPDATED', { hotel });
    emitToSuperAdmin('HOTEL_STATUS_UPDATED', { hotel });

    res.status(200).json({
      success: true,
      message: `Hotel '${hotel.name}' status updated to ${status}. An email with the reason was sent to ${hotel.ownerEmail}. ${
        status === 'DISABLED' || status === 'SUSPENDED'
          ? 'All hotel users are now immediately blocked from operational access.'
          : 'Access restored.'
      }`,
      data: {
        _id: hotel._id,
        name: hotel.name,
        status: hotel.status,
        statusReason: hotel.statusReason,
        ownerEmail: hotel.ownerEmail,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update Hotel Details, Status, or Trial/Subscription (Super Admin Edit)
// @route   PUT /api/v1/super-admin/hotels/:id
export const updateHotelDetails = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const hotel = await Hotel.findById(req.params.id);
    if (!hotel) {
      res.status(404).json({ success: false, message: 'Hotel not found' });
      return;
    }

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
      status,
      statusReason,
      totalRooms,
      hotelType,
      website,
      subscriptionPlan,
      subscriptionStatus,
      trialEndDate,
      extendTrialDays,
    } = req.body;

    if (name) hotel.name = name;
    if (ownerName) hotel.ownerName = ownerName;
    if (ownerEmail) hotel.ownerEmail = ownerEmail.toLowerCase();
    if (ownerPhone) hotel.ownerPhone = ownerPhone;
    if (address) hotel.address = address;
    if (city) hotel.city = city;
    if (state) hotel.state = state;
    if (country) hotel.country = country;
    if (pincode) hotel.pincode = pincode;
    if (status) hotel.status = status;
    if (statusReason !== undefined) hotel.statusReason = statusReason;
    if (totalRooms !== undefined) hotel.totalRooms = Number(totalRooms);
    if (hotelType) hotel.hotelType = hotelType;
    if (website !== undefined) hotel.website = website;

    // Subscription & Trial Updates
    if (!hotel.subscription) {
      hotel.subscription = { plan: 'TRIAL', status: 'TRIAL', trialStartDate: new Date(), trialEndDate: new Date(), autoRenew: false };
    }

    if (subscriptionPlan) {
      hotel.subscription.plan = subscriptionPlan;
    }
    if (subscriptionStatus) {
      hotel.subscription.status = subscriptionStatus;
    }

    const { customTrialDays } = req.body;

    if (trialEndDate) {
      const parsedDate = new Date(trialEndDate);
      if (!isNaN(parsedDate.getTime())) {
        hotel.subscription.trialEndDate = parsedDate;
        if (parsedDate > new Date()) {
          hotel.subscription.status = 'TRIAL';
          hotel.subscription.isExpired = false;
          hotel.status = 'ACTIVE'; // ⚡ Auto-activate hotel when trial date is in the future
        } else {
          hotel.subscription.status = 'EXPIRED';
          hotel.subscription.isExpired = true;
          hotel.status = 'EXPIRED';
        }
      }
    } else if (customTrialDays !== undefined && customTrialDays !== null && Number(customTrialDays) > 0) {
      // Set trial for exactly N custom days from now
      hotel.subscription.trialEndDate = new Date(Date.now() + Number(customTrialDays) * 24 * 60 * 60 * 1000);
      hotel.subscription.status = 'TRIAL';
      hotel.subscription.isExpired = false;
      hotel.status = 'ACTIVE';
    } else if (extendTrialDays && Number(extendTrialDays) > 0) {
      const currentEnd = hotel.subscription.trialEndDate ? new Date(hotel.subscription.trialEndDate) : new Date();
      const newEnd = new Date(Math.max(currentEnd.getTime(), Date.now()) + Number(extendTrialDays) * 24 * 60 * 60 * 1000);
      hotel.subscription.trialEndDate = newEnd;
      hotel.subscription.status = 'TRIAL';
      hotel.subscription.isExpired = false;
      hotel.status = 'ACTIVE';
    }

    // Final check: If trialEndDate is in the future, ensure hotel is ACTIVE and not EXPIRED
    if (hotel.subscription.trialEndDate && new Date(hotel.subscription.trialEndDate) > new Date()) {
      hotel.subscription.isExpired = false;
      hotel.subscription.status = 'TRIAL';
      hotel.status = 'ACTIVE';
    }

    await hotel.save();

    // ⚡ Socket.IO Realtime Broadcasts
    emitToHotel(hotel._id, 'HOTEL_STATUS_UPDATED', { hotel });
    emitToSuperAdmin('HOTEL_STATUS_UPDATED', { hotel });

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: 'HOTEL_EDITED',
        module: 'HOTELS',
        hotelId: hotel._id,
        newValue: { name: hotel.name, status: hotel.status, subscription: hotel.subscription },
      });
    }

    res.status(200).json({
      success: true,
      message: `Hotel '${hotel.name}' updated successfully!`,
      data: hotel,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Extend Trial or Provide Grace Period
// @route   PUT /api/v1/super-admin/hotels/:id/extend-trial
export const extendTrialOrSubscription = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { additionalDays = 15, plan } = req.body;
    const hotel = await Hotel.findById(req.params.id);
    if (!hotel) {
      res.status(404).json({ success: false, message: 'Hotel not found' });
      return;
    }

    const currentEnd = hotel.subscription.trialEndDate ? new Date(hotel.subscription.trialEndDate) : new Date();
    const newTrialEnd = new Date(Math.max(currentEnd.getTime(), Date.now()) + Number(additionalDays) * 24 * 60 * 60 * 1000);

    hotel.subscription.trialEndDate = newTrialEnd;
    hotel.subscription.status = 'TRIAL';
    if (plan) {
      hotel.subscription.plan = plan;
    }
    hotel.status = 'ACTIVE';
    await hotel.save();

    // ⚡ Socket.IO Realtime Broadcasts
    emitToHotel(hotel._id, 'HOTEL_UPDATED', { hotel });
    emitToSuperAdmin('HOTEL_UPDATED', { hotel });
    emitGlobal('HOTEL_UPDATED', { hotel });
    emitGlobal('SUBSCRIPTION_UPDATED', { hotel });

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: 'TRIAL_EXTENDED',
        module: 'HOTELS',
        hotelId: hotel._id,
        newValue: { additionalDays, newTrialEnd },
      });
    }

    res.status(200).json({
      success: true,
      message: `Trial extended by ${additionalDays} days for '${hotel.name}'.`,
      trialEndDate: newTrialEnd,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Reset Hotel Admin Password by Super Admin
// @route   PUT /api/v1/super-admin/hotels/:id/reset-admin-password
export const resetHotelAdminPassword = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const hotel = await Hotel.findById(req.params.id);
    if (!hotel) {
      res.status(404).json({ success: false, message: 'Hotel not found' });
      return;
    }

    const adminUser = await User.findOne({ hotel: hotel._id, role: 'HOTEL_ADMIN' });
    if (!adminUser) {
      res.status(404).json({ success: false, message: 'Hotel Admin user account not found.' });
      return;
    }

    const rawTempPassword = 'Reset@' + crypto.randomBytes(4).toString('hex') + '#26';
    adminUser.password = rawTempPassword;
    adminUser.mustChangePassword = true;
    await adminUser.save();

    await queueEmail('HOTEL_ADMIN_PASSWORD_RESET', adminUser.email, {
      hotelName: hotel.name,
      temporaryPassword: rawTempPassword,
    });

    res.status(200).json({
      success: true,
      message: `Password reset successfully for ${adminUser.email}.`,
      temporaryPassword: rawTempPassword,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    View Global System Audit Logs (Super Admin only)
// @route   GET /api/v1/super-admin/audit-logs
export const getSuperAdminAuditLogs = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { module, action, limit = 50 } = req.query;
    const query: any = {};
    if (module) query.module = module;
    if (action) query.action = action;

    const logs = await AuditLog.find(query).sort({ timestamp: -1 }).limit(Number(limit));
    res.status(200).json({ success: true, count: logs.length, data: logs });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get All Guests of a Specific Hotel (Super Admin View & Search)
// @route   GET /api/v1/super-admin/hotels/:id/guests
export const getHotelGuestsForSuperAdmin = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const hotelId = req.params.id as string;
    if (!hotelId || !mongoose.Types.ObjectId.isValid(hotelId)) {
      res.status(400).json({ success: false, message: 'Invalid hotel ID context' });
      return;
    }

    const hotel = await Hotel.findById(hotelId).select('name ownerName ownerEmail city phone');
    if (!hotel) {
      res.status(404).json({ success: false, message: 'Hotel not found' });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 10));
    const search = (req.query.search as string || '').trim();

    const hotelObjId = new mongoose.Types.ObjectId(hotelId);
    const query: any = {
      hotel: hotelObjId,
      isDeleted: { $ne: true },
    };

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      query.$or = [
        { fullName: regex },
        { mobileNumber: regex },
        { email: regex },
        { city: regex },
        { 'idProof.idNumber': regex },
      ];
    }

    const totalRecords = await Guest.countDocuments(query);
    const totalPages = Math.ceil(totalRecords / limit) || 1;

    const guests = await Guest.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const guestIds = guests.map((g) => g._id);
    const latestBookings = await Booking.find({
      guest: { $in: guestIds },
      hotel: hotelObjId,
    })
      .populate('room', 'roomNumber')
      .sort({ createdAt: -1 });

    const formattedGuests = guests.map((g) => {
      const gObj = g.toObject();
      const booking = latestBookings.find((b) => b.guest?.toString() === g._id.toString());
      return {
        ...gObj,
        latestBookingNumber: booking?.bookingNumber || 'N/A',
        latestRoomNumber: (booking?.room as any)?.roomNumber || 'N/A',
        latestBookingStatus: booking?.status || 'COMPLETED',
      };
    });

    res.status(200).json({
      success: true,
      hotel: {
        _id: hotel._id,
        name: hotel.name,
        ownerName: hotel.ownerName,
        city: hotel.city,
      },
      data: formattedGuests,
      pagination: {
        page,
        limit,
        totalRecords,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
