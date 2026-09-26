import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User';
import Hotel from '../models/Hotel';
import PasswordResetToken from '../models/PasswordResetToken';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import sendEmail from '../utils/sendEmail';
import { passwordResetOtpTemplate } from '../utils/emailTemplates';

// Access Token Generator (Short-lived: 1 Hour)
export const generateAccessToken = (id: string, role: string): string => {
  const secret = process.env.JWT_SECRET || 'super_hotel_jwt_secret_key_2026_modern_secure';
  return jwt.sign({ id, role, tokenType: 'ACCESS' }, secret, {
    expiresIn: '1h',
  });
};

// Refresh Token Generator (Long-lived: 30 Days)
export const generateRefreshToken = (id: string): string => {
  const refreshSecret =
    process.env.JWT_REFRESH_SECRET ||
    (process.env.JWT_SECRET || 'super_hotel_jwt_secret_key_2026_modern_secure') + '_refresh';
  return jwt.sign({ id, tokenType: 'REFRESH' }, refreshSecret, {
    expiresIn: '30d',
  });
};

// Compute Live Subscription & 30-Day Trial Telemetry
export const computeSubscriptionMetrics = (hotel: any) => {
  if (!hotel || !hotel.subscription) return null;
  const sub = hotel.subscription;
  const now = new Date();
  const trialEnd = sub.trialEndDate ? new Date(sub.trialEndDate) : null;
  const subEnd = sub.subscriptionEndDate ? new Date(sub.subscriptionEndDate) : null;

  let isTrialActive = false;
  let isSubActive = false;
  let isExpired = false;
  let daysLeft = 0;
  let totalDays = 30;
  let elapsedDays = 0;
  let elapsedPercentage = 0;

  if (sub.status === 'TRIAL' || (!sub.subscriptionEndDate && trialEnd)) {
    if (trialEnd) {
      const diffMs = trialEnd.getTime() - now.getTime();
      daysLeft = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      isTrialActive = diffMs > 0;
      isExpired = !isTrialActive;
      const start = sub.trialStartDate ? new Date(sub.trialStartDate) : new Date(trialEnd.getTime() - 30 * 86400000);
      const totalTrialMs = trialEnd.getTime() - start.getTime();
      totalDays = Math.max(1, Math.round(totalTrialMs / 86400000));
      elapsedDays = Math.max(0, Math.min(totalDays, totalDays - daysLeft));
      elapsedPercentage = Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100)));
    }
  } else if (sub.status === 'ACTIVE' || subEnd) {
    if (subEnd) {
      const diffMs = subEnd.getTime() - now.getTime();
      daysLeft = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      isSubActive = diffMs > 0;
      isExpired = !isSubActive;
    } else {
      isSubActive = true;
      daysLeft = 365;
    }
  } else {
    isExpired = true;
  }

  return {
    plan: sub.plan || 'TRIAL',
    status: isExpired ? 'EXPIRED' : isSubActive ? 'ACTIVE' : isTrialActive ? 'TRIAL' : sub.status,
    trialStartDate: sub.trialStartDate,
    trialEndDate: sub.trialEndDate,
    subscriptionStartDate: sub.subscriptionStartDate,
    subscriptionEndDate: sub.subscriptionEndDate,
    gracePeriodUntil: sub.gracePeriodUntil,
    autoRenew: sub.autoRenew ?? true,
    daysLeft,
    totalDays,
    elapsedDays,
    elapsedPercentage,
    isTrialActive,
    isSubActive,
    isExpired,
  };
};

// Set Access & Refresh Tokens in Cookies and return complete auth payload
const sendTokenResponse = async (
  user: any,
  statusCode: number,
  res: Response,
  message: string
): Promise<void> => {
  const accessToken = generateAccessToken(user._id.toString(), user.role);
  const refreshToken = generateRefreshToken(user._id.toString());

  const isProd = process.env.NODE_ENV === 'production';
  const accessCookieOptions = {
    expires: new Date(Date.now() + 60 * 60 * 1000), // 1 Hour
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as any,
  };

  const refreshCookieOptions = {
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 Days
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as any,
  };

  let hotelDetails: any = null;
  let liveSubscription: any = null;
  if (user.hotel) {
    hotelDetails = await Hotel.findById(user.hotel);
    if (hotelDetails) {
      liveSubscription = computeSubscriptionMetrics(hotelDetails);
    }
  }

  res
    .status(statusCode)
    .cookie('token', accessToken, accessCookieOptions)
    .cookie('refreshToken', refreshToken, refreshCookieOptions)
    .json({
      success: true,
      message,
      token: accessToken,
      accessToken,
      refreshToken,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        hotel: hotelDetails
          ? {
              _id: hotelDetails._id,
              name: hotelDetails.name,
              slug: hotelDetails.slug,
              status: hotelDetails.status,
              statusReason: hotelDetails.statusReason,
              subscription: liveSubscription || hotelDetails.subscription,
              settings: hotelDetails.settings,
              supportContact: {
                phone: '+91 98765 43210',
                email: 'support@cloudhotelier.com',
                whatsapp: '+919876543210',
              },
            }
          : undefined,
      },
    });
};

// @desc    Refresh Access Token using Long-Lived Refresh Token
// @route   POST /api/v1/auth/refresh-token
export const refreshTokenHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshToken = req.body?.refreshToken || req.cookies?.refreshToken;

    if (!refreshToken) {
      res.status(401).json({
        success: false,
        message: 'Refresh token missing. Please login again.',
      });
      return;
    }

    const refreshSecret =
      process.env.JWT_REFRESH_SECRET ||
      (process.env.JWT_SECRET || 'super_hotel_jwt_secret_key_2026_modern_secure') + '_refresh';

    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, refreshSecret);
    } catch (err) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token. Please login again.',
      });
      return;
    }

    const user = await User.findById(decoded.id);

    if (!user) {
      res.status(401).json({ success: false, message: 'User account not found.' });
      return;
    }

    if (user.status === 'INACTIVE' || user.status === 'BLOCKED' || user.status === 'DELETED' || user.isDeleted) {
      res.status(403).json({ success: false, message: 'Account is deactivated or disabled.' });
      return;
    }

    const newAccessToken = generateAccessToken(user._id.toString(), user.role);
    const newRefreshToken = generateRefreshToken(user._id.toString());

    const isProd = process.env.NODE_ENV === 'production';
    const accessCookieOptions = {
      expires: new Date(Date.now() + 60 * 60 * 1000), // 1 Hour
      httpOnly: true,
      secure: isProd,
      sameSite: (isProd ? 'none' : 'lax') as any,
    };

    const refreshCookieOptions = {
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 Days
      httpOnly: true,
      secure: isProd,
      sameSite: (isProd ? 'none' : 'lax') as any,
    };

    res
      .status(200)
      .cookie('token', newAccessToken, accessCookieOptions)
      .cookie('refreshToken', newRefreshToken, refreshCookieOptions)
      .json({
        success: true,
        message: 'Access token refreshed successfully.',
        token: newAccessToken,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Login User (Super Admin, Hotel Admin, Receptionist)
// @route   POST /api/v1/auth/login
export const loginUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ success: false, message: 'Please provide email and password.' });
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      res.status(401).json({ success: false, message: 'Invalid email or password.' });
      return;
    }

    // Check if account locked
    if (user.accountLockedUntil && user.accountLockedUntil > new Date()) {
      res.status(403).json({
        success: false,
        message: 'Account temporarily locked due to multiple failed attempts. Try again later.',
      });
      return;
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= 5) {
        user.accountLockedUntil = new Date(Date.now() + 15 * 60 * 1000); // Lock for 15 mins
      }
      await user.save();
      res.status(401).json({ success: false, message: 'Invalid email or password.' });
      return;
    }

    // Reset failed attempts & record login time
    user.failedLoginAttempts = 0;
    user.lastLoginAt = new Date();
    await user.save();

    // Check if Staff / User is INACTIVE or BLOCKED by Hotel Admin
    if (user.status === 'INACTIVE' || user.status === 'BLOCKED' || user.status === 'DELETED' || user.isDeleted) {
      res.status(403).json({
        success: false,
        errorCode: 'STAFF_INACTIVE',
        message: user.status === 'INACTIVE'
          ? 'Your staff account has been deactivated by Hotel Administration. You cannot access the system.'
          : 'Your account has been disabled. Please contact your Hotel Administrator.',
      });
      return;
    }

    // If User belongs to a hotel, check if hotel is DISABLED or SUSPENDED
    if (user.role !== 'SUPER_ADMIN' && user.hotel) {
      const hotel = await Hotel.findById(user.hotel);
      if (hotel) {
        if (hotel.status === 'DISABLED' || hotel.status === 'SUSPENDED') {
          res.status(403).json({
            success: false,
            errorCode: hotel.status === 'DISABLED' ? 'HOTEL_DISABLED' : 'HOTEL_SUSPENDED',
            message: hotel.statusReason
              ? `Your hotel account has been ${hotel.status.toLowerCase()}: ${hotel.statusReason}. Please contact support.`
              : `Your hotel account has been ${hotel.status.toLowerCase()}. All operational portals are suspended. Please contact support.`,
            hotelStatus: hotel.status,
            statusReason: hotel.statusReason,
            supportContact: {
              phone: '+91 98765 43210',
              email: 'support@cloudhotelier.com',
              whatsapp: '+919876543210',
            },
          });
          return;
        }
        if (hotel.status === 'PENDING_APPROVAL') {
          res.status(403).json({
            success: false,
            errorCode: 'PENDING_APPROVAL',
            message: 'Your hotel registration is currently pending Super Admin approval.',
            hotelStatus: hotel.status,
            supportContact: {
              phone: '+91 98765 43210',
              email: 'support@cloudhotelier.com',
            },
          });
          return;
        }
      }
    }

    await sendTokenResponse(user, 200, res, 'Login successful.');
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Change Password (for logged-in user - removes mustChangePassword flag)
// @route   PUT /api/v1/auth/change-password
export const changePassword = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(400).json({ success: false, message: 'Current password and new password are required.' });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ success: false, message: 'New password must be at least 6 characters long.' });
      return;
    }

    const user = await User.findById(req.user?._id);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      res.status(400).json({ success: false, message: 'Current password is incorrect.' });
      return;
    }

    user.password = newPassword;
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date();
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password changed successfully.',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Forgot Password - Send OTP to Email
// @route   POST /api/v1/auth/forgot-password
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email || !email.trim()) {
      res.status(400).json({ success: false, message: 'Please provide registered email address.' });
      return;
    }

    const cleanEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      res.status(404).json({
        success: false,
        message: `No account registered with "${cleanEmail}". Please check your email address.`,
      });
      return;
    }

    // Generate 6-digit OTP & Reset Token
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const token = crypto.randomBytes(20).toString('hex');

    await PasswordResetToken.create({
      user: user._id,
      token,
      otp,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 mins
    });

    console.log(`\n========================================\n🔑 PASSWORD RESET OTP for ${user.email}: [ ${otp} ]\n========================================\n`);

    // Send OTP email via Dual-Engine Dispatcher
    try {
      await sendEmail({
        email: user.email,
        subject: 'Your Password Reset OTP - The Grand Royale',
        html: passwordResetOtpTemplate(user.name, otp),
      });
    } catch (e: any) {
      console.warn('Failed to send OTP email:', e.message);
    }

    res.status(200).json({
      success: true,
      message: `6-digit OTP has been sent securely to ${user.email}. Please check your inbox / spam folder.`,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// @desc    Reset Password with OTP
// @route   POST /api/v1/auth/reset-password
export const resetPasswordWithOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      res.status(400).json({ success: false, message: 'Email, OTP, and new password are required.' });
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
      return;
    }

    const resetRecord = await PasswordResetToken.findOne({
      user: user._id,
      otp,
      used: false,
      expiresAt: { $gt: new Date() },
    });

    if (!resetRecord) {
      res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
      return;
    }

    user.password = newPassword;
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date();
    await user.save();

    resetRecord.used = true;
    await resetRecord.save();

    res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You can now login.',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get Current Logged-in User Profile & Hotel Info
// @route   GET /api/v1/auth/me
export const getMe = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user?._id).populate('hotel');
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    const userObj = user.toObject() as any;
    if (userObj.hotel && typeof userObj.hotel === 'object') {
      const liveSub = computeSubscriptionMetrics(userObj.hotel);
      userObj.hotel.subscription = liveSub || userObj.hotel.subscription;
      userObj.hotel.supportContact = {
        phone: '+91 98765 43210',
        email: 'support@cloudhotelier.com',
        whatsapp: '+919876543210',
      };
    }

    res.status(200).json({ success: true, data: userObj });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Logout User & Clear Cookie
// @route   POST /api/v1/auth/logout
export const logoutUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const isProd = process.env.NODE_ENV === 'production';
    const clearOptions = {
      httpOnly: true,
      secure: isProd,
      sameSite: (isProd ? 'none' : 'lax') as any,
      expires: new Date(0),
    };
    res.cookie('token', '', clearOptions);
    res.cookie('refreshToken', '', clearOptions);
    res.status(200).json({ success: true, message: 'Logged out successfully.' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
