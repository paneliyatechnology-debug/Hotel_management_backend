import { Response } from 'express';
import crypto from 'crypto';
import Hotel from '../models/Hotel';
import User from '../models/User';
import AuditLog from '../models/AuditLog';
import Payment from '../models/Payment';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import sendEmail from '../utils/sendEmail';
import logAuditAction from '../utils/auditLogger';
import {
  hotelApprovedEmailTemplate,
  hotelRejectedEmailTemplate,
  hotelStatusDisabledEmailTemplate,
  hotelReEnabledEmailTemplate,
} from '../utils/emailTemplates';

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
    const paidHotels = await Hotel.countDocuments({ 'subscription.status': 'ACTIVE', isDeleted: false });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const paymentsSummary = await Payment.aggregate([
      { $match: { paymentStatus: 'PAID' } },
      { $group: { _id: null, totalRevenue: { $sum: '$amount' } } },
    ]);
    const totalRevenue = paymentsSummary.length > 0 ? paymentsSummary[0].totalRevenue : 0;

    const todayPayments = await Payment.aggregate([
      { $match: { paymentStatus: 'PAID', createdAt: { $gte: startOfToday } } },
      { $group: { _id: null, revenue: { $sum: '$amount' } } },
    ]);
    const todayRevenue = todayPayments.length > 0 ? todayPayments[0].revenue : 0;

    const monthPayments = await Payment.aggregate([
      { $match: { paymentStatus: 'PAID', createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, revenue: { $sum: '$amount' } } },
    ]);
    const monthlyRevenue = monthPayments.length > 0 ? monthPayments[0].revenue : 0;

    const totalOrders = await Payment.countDocuments({ paymentStatus: 'PAID' });

    const recentPending = await Hotel.find({ status: 'PENDING_APPROVAL', isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(5);

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
        paidHotels,
        totalRevenue,
        monthlyRevenue,
        todayRevenue,
        totalOrders,
        recentPending,
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

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      data: hotels,
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

    const staff = await User.find({ hotel: hotel._id }).select('-password');
    res.status(200).json({
      success: true,
      data: {
        hotel,
        staff,
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

    const loginUrl = process.env.ADMIN_URL || 'https://hotel-management-admin-livid.vercel.app/login';
    try {
      await sendEmail({
        email: hotel.ownerEmail,
        subject: `🎉 Congratulations! ${hotel.name} Approved - Your Admin Credentials`,
        html: hotelApprovedEmailTemplate({
          hotelName: hotel.name,
          ownerName: hotel.ownerName,
          adminEmail: hotel.ownerEmail,
          temporaryPassword: rawTempPassword,
          loginUrl,
          trialStartDate: trialStart.toLocaleDateString('en-IN'),
          trialEndDate: trialEnd.toLocaleDateString('en-IN'),
        }),
      });
    } catch (emailErr: any) {
      console.warn('Failed to send approval email:', emailErr.message);
    }

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

    try {
      await sendEmail({
        email: hotel.ownerEmail,
        subject: `Hotel Registration Status Update: ${hotel.name}`,
        html: hotelRejectedEmailTemplate(hotel.name, hotel.ownerName, hotel.rejectionReason || 'Criteria not met'),
      });
    } catch (emailErr: any) {
      console.warn('Rejection email failed to send:', emailErr.message);
    }

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: 'HOTEL_REJECTED',
        module: 'HOTELS',
        hotelId: hotel._id,
        newValue: { status: 'REJECTED', reason: hotel.rejectionReason },
      });
    }

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

    // 📧 Send Email Notification to Hotel Owner with the Exact Reason
    try {
      if (status === 'DISABLED' || status === 'SUSPENDED') {
        await sendEmail({
          email: hotel.ownerEmail,
          subject: `⚠️ Notice: Your Hotel Account Has Been ${status} - ${hotel.name}`,
          html: hotelStatusDisabledEmailTemplate({
            hotelName: hotel.name,
            ownerName: hotel.ownerName,
            status,
            reason: reason || 'Administrative policy compliance.',
          }),
        });
      } else if (status === 'ACTIVE' && (oldStatus === 'DISABLED' || oldStatus === 'SUSPENDED')) {
        await sendEmail({
          email: hotel.ownerEmail,
          subject: `✅ Good News: Your Hotel Account Has Been Re-Activated - ${hotel.name}`,
          html: hotelReEnabledEmailTemplate(hotel.name, hotel.ownerName),
        });
      }
    } catch (emailErr: any) {
      console.warn('Status change notification email failed to send:', emailErr.message);
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

    try {
      await sendEmail({
        email: adminUser.email,
        subject: `Your Hotel Admin Password Has Been Reset - ${hotel.name}`,
        html: `
          <div style="font-family: Arial; padding: 25px; background: #0f172a; color: #fff; border-radius: 8px;">
            <h2 style="color: #f59e0b;">Password Reset Notification</h2>
            <p>Your password for Hotel Admin account at <strong>${hotel.name}</strong> was reset by Super Administrator.</p>
            <div style="background: #1e293b; padding: 15px; border-radius: 6px; margin: 15px 0;">
              <p style="margin: 0; color: #94a3b8;">New Temporary Password: <strong style="color: #34d399; font-family: monospace; font-size: 16px;">${rawTempPassword}</strong></p>
            </div>
            <p style="font-size: 12px; color: #94a3b8;">You will be asked to create a new password on your next login.</p>
          </div>
        `,
      });
    } catch (e: any) {
      console.warn('Failed to send reset email:', e.message);
    }

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
