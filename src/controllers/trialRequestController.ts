import { Response } from 'express';
import TrialRequest from '../models/TrialRequest';
import Hotel from '../models/Hotel';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { emitToHotel, emitToSuperAdmin, emitGlobal } from '../utils/socketService';
import logAuditAction from '../utils/auditLogger';

// @desc    Submit a Trial Extension Request (Hotel Admin)
// @route   POST /api/v1/hotels/request-trial-extension
export const submitTrialRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { requestedDays = 30, reason } = req.body;
    const user = req.user;

    if (!user || !user.hotel) {
      res.status(400).json({ success: false, message: 'Only registered hotel admins can submit a trial extension request.' });
      return;
    }

    if (!reason || !reason.trim()) {
      res.status(400).json({ success: false, message: 'Please provide a clear reason for requesting a trial extension.' });
      return;
    }

    const hotel = await Hotel.findById(user.hotel);
    if (!hotel) {
      res.status(404).json({ success: false, message: 'Associated hotel not found.' });
      return;
    }

    // Check if there is already an active PENDING request for this hotel
    const existingPending = await TrialRequest.findOne({ hotel: hotel._id, status: 'PENDING' });
    if (existingPending) {
      res.status(400).json({
        success: false,
        message: 'A trial extension request is already pending review by Super Admin. Please await approval.',
      });
      return;
    }

    const trialReq = await TrialRequest.create({
      hotel: hotel._id,
      requestedBy: user._id,
      hotelName: hotel.name,
      ownerName: hotel.ownerName || user.name,
      ownerEmail: hotel.ownerEmail || user.email,
      ownerPhone: hotel.ownerPhone || user.phone || '',
      requestedDays: Number(requestedDays) || 30,
      reason: reason.trim(),
      status: 'PENDING',
    });

    // ⚡ Emit Socket.IO event to Super Admin Dashboard instantly
    emitToSuperAdmin('NEW_TRIAL_REQUEST', { request: trialReq });
    emitGlobal('NEW_TRIAL_REQUEST', { request: trialReq });

    await logAuditAction({
      user,
      action: 'TRIAL_EXTENSION_REQUESTED',
      module: 'HOTELS',
      hotelId: hotel._id,
      newValue: { requestedDays, reason },
    });

    res.status(201).json({
      success: true,
      message: 'Trial extension request submitted successfully! Super Admin has been notified in real-time.',
      data: trialReq,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get All Trial Requests (Super Admin)
// @route   GET /api/v1/super-admin/trial-requests
export const getTrialRequests = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { status } = req.query;
    const query: any = {};
    if (status) {
      query.status = status;
    }

    const requests = await TrialRequest.find(query)
      .populate('hotel', 'name ownerName ownerEmail status subscription')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: requests.length,
      data: requests,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Approve Trial Extension Request (Super Admin)
// @route   PUT /api/v1/super-admin/trial-requests/:id/approve
export const approveTrialRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { approvedDays, customEndDate, remarks } = req.body;
    const trialReq = await TrialRequest.findById(req.params.id);

    if (!trialReq) {
      res.status(404).json({ success: false, message: 'Trial request not found.' });
      return;
    }

    const hotel = await Hotel.findById(trialReq.hotel);
    if (!hotel) {
      res.status(404).json({ success: false, message: 'Associated hotel property not found.' });
      return;
    }

    let newEnd: Date;
    if (customEndDate) {
      const parsed = new Date(customEndDate);
      if (!isNaN(parsed.getTime())) {
        newEnd = parsed;
      } else {
        const daysToAdd = Number(approvedDays) || trialReq.requestedDays || 30;
        const currentEnd = hotel.subscription?.trialEndDate ? new Date(hotel.subscription.trialEndDate) : new Date();
        newEnd = new Date(Math.max(currentEnd.getTime(), Date.now()) + daysToAdd * 24 * 60 * 60 * 1000);
      }
    } else {
      const daysToAdd = Number(approvedDays) || trialReq.requestedDays || 30;
      const currentEnd = hotel.subscription?.trialEndDate ? new Date(hotel.subscription.trialEndDate) : new Date();
      newEnd = new Date(Math.max(currentEnd.getTime(), Date.now()) + daysToAdd * 24 * 60 * 60 * 1000);
    }

    if (!hotel.subscription) {
      hotel.subscription = { plan: 'TRIAL', status: 'TRIAL', trialStartDate: new Date(), trialEndDate: newEnd, autoRenew: false };
    } else {
      hotel.subscription.trialEndDate = newEnd;
      hotel.subscription.status = 'TRIAL';
    }

    hotel.status = 'ACTIVE';
    await hotel.save();

    const formattedEnd = newEnd.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    trialReq.status = 'APPROVED';
    trialReq.adminRemarks = remarks || `Approved until ${formattedEnd} by Super Admin.`;
    await trialReq.save();

    // ⚡ Socket.IO Realtime Broadcasts
    emitToHotel(hotel._id, 'TRIAL_REQUEST_APPROVED', { request: trialReq, hotel });
    emitToHotel(hotel._id, 'HOTEL_UPDATED', { hotel });
    emitToSuperAdmin('TRIAL_REQUEST_APPROVED', { request: trialReq, hotel });
    emitGlobal('HOTEL_UPDATED', { hotel });
    emitGlobal('SUBSCRIPTION_UPDATED', { hotel });

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: 'TRIAL_REQUEST_APPROVED',
        module: 'HOTELS',
        hotelId: hotel._id,
        newValue: { newEnd, remarks },
      });
    }

    res.status(200).json({
      success: true,
      message: `Trial request approved! Trial active until ${formattedEnd} for '${hotel.name}'.`,
      data: { request: trialReq, hotel },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Reject Trial Extension Request (Super Admin)
// @route   PUT /api/v1/super-admin/trial-requests/:id/reject
export const rejectTrialRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { remarks } = req.body;
    const trialReq = await TrialRequest.findById(req.params.id);

    if (!trialReq) {
      res.status(404).json({ success: false, message: 'Trial request not found.' });
      return;
    }

    trialReq.status = 'REJECTED';
    trialReq.adminRemarks = remarks || 'Request rejected by Super Admin.';
    await trialReq.save();

    // ⚡ Socket.IO Realtime Broadcasts
    emitToHotel(trialReq.hotel, 'TRIAL_REQUEST_REJECTED', { request: trialReq });
    emitToSuperAdmin('TRIAL_REQUEST_REJECTED', { request: trialReq });

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: 'TRIAL_REQUEST_REJECTED',
        module: 'HOTELS',
        hotelId: trialReq.hotel,
        newValue: { remarks },
      });
    }

    res.status(200).json({
      success: true,
      message: `Trial extension request rejected for '${trialReq.hotelName}'.`,
      data: trialReq,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
