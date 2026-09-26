import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User, { IUser, UserRole } from '../models/User';
import Hotel, { IHotel } from '../models/Hotel';

// Extend Express Request type
export interface AuthenticatedRequest extends Request {
  user?: IUser;
  hotel?: IHotel;
  hotelId?: string;
}

// 1. Authenticate JWT from Cookie or Bearer Header
export const authenticateUser = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  let token: string | undefined;

  // Check Cookie first
  if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
    return;
  }

  try {
    const secret = process.env.JWT_SECRET || 'super_hotel_jwt_secret_key_2026_modern_secure';
    const decoded = jwt.verify(token, secret) as { id: string; role: string };

    const user = await User.findById(decoded.id);

    if (!user) {
      res.status(401).json({ success: false, message: 'User account not found.' });
      return;
    }

    if (user.status === 'INACTIVE' || user.status === 'BLOCKED' || user.status === 'DELETED' || user.isDeleted) {
      res.status(403).json({
        success: false,
        errorCode: 'STAFF_INACTIVE',
        message: user.status === 'INACTIVE'
          ? 'Your staff account has been deactivated by Hotel Administration. All operational access is terminated.'
          : 'Your user account has been disabled or removed. Contact administrator.',
      });
      return;
    }

    req.user = user;
    if (user.hotel) {
      req.hotelId = user.hotel.toString();
    }

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      res.status(401).json({
        success: false,
        isExpired: true,
        errorCode: 'TOKEN_EXPIRED',
        message: 'Session access token has expired (1 hour limit). Call POST /api/v1/auth/refresh-token with your refreshToken to get a new access token.',
      });
      return;
    }
    res.status(401).json({ success: false, message: 'Invalid session token. Please login again.' });
  }
};

// 2. Role Based Access Control (RBAC)
export const requireRole = (...roles: UserRole[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required.' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: `Access denied. Role '${req.user.role}' is not authorized for this operation.`,
      });
      return;
    }

    next();
  };
};

// 3. Multi-Tenant Guard: Verify Hotel is ACTIVE (blocks all staff immediately if hotel is disabled/suspended)
export const requireActiveHotel = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  // Super Admin can access globally without being tied to an active hotel check
  if (req.user.role === 'SUPER_ADMIN') {
    return next();
  }

  if (!req.user.hotel) {
    res.status(403).json({ success: false, message: 'No hotel assigned to this user.' });
    return;
  }

  try {
    const hotel = await Hotel.findById(req.user.hotel);

    if (!hotel || hotel.isDeleted) {
      res.status(404).json({ success: false, message: 'Hotel record not found or has been removed.' });
      return;
    }

    if (hotel.status === 'DISABLED' || hotel.status === 'SUSPENDED') {
      res.status(403).json({
        success: false,
        errorCode: hotel.status === 'DISABLED' ? 'HOTEL_DISABLED' : 'HOTEL_SUSPENDED',
        message: hotel.statusReason
          ? `Your hotel account has been ${hotel.status.toLowerCase()}: ${hotel.statusReason}. Please contact Super Admin support.`
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
        message: 'Your hotel registration is currently pending Super Admin review and approval.',
        hotelStatus: hotel.status,
        supportContact: {
          phone: '+91 98765 43210',
          email: 'support@cloudhotelier.com',
        },
      });
      return;
    }

    if (hotel.status === 'REJECTED') {
      res.status(403).json({
        success: false,
        errorCode: 'HOTEL_REJECTED',
        message: `Hotel registration was rejected. Reason: ${hotel.rejectionReason || 'Contact support for details.'}`,
        hotelStatus: hotel.status,
      });
      return;
    }

    req.hotel = hotel;
    req.hotelId = hotel._id.toString();
    next();
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. Subscription & Real-Time Trial Enforcement
export const requireActiveSubscription = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (req.user?.role === 'SUPER_ADMIN') {
    return next();
  }

  const hotel = req.hotel;
  if (!hotel) {
    return next(); // handled by requireActiveHotel
  }

  const now = new Date();
  const trialEndDate = hotel.subscription?.trialEndDate ? new Date(hotel.subscription.trialEndDate) : null;
  const subEndDate = hotel.subscription?.subscriptionEndDate ? new Date(hotel.subscription.subscriptionEndDate) : null;
  const graceEndDate = hotel.subscription?.gracePeriodUntil ? new Date(hotel.subscription.gracePeriodUntil) : null;

  const isTrialValid = trialEndDate ? trialEndDate > now : false;
  const isSubValid = subEndDate ? subEndDate > now : false;
  const isGraceValid = graceEndDate ? graceEndDate > now : false;

  const isAccessAllowed =
    hotel.subscription?.status === 'ACTIVE' ||
    (hotel.subscription?.status === 'TRIAL' && isTrialValid) ||
    isSubValid ||
    isGraceValid;

  if (!isAccessAllowed) {
    // If expired, Receptionist / Staff is completely blocked from all frontdesk operations
    if (req.user?.role === 'RECEPTIONIST') {
      res.status(403).json({
        success: false,
        errorCode: 'SUBSCRIPTION_EXPIRED',
        message: 'Hotel 30-day free trial or subscription has expired. Front desk operations are suspended.',
        subscriptionStatus: 'EXPIRED',
        trialEndDate,
        supportContact: {
          phone: '+91 98765 43210',
          email: 'support@cloudhotelier.com',
          whatsapp: '+919876543210',
        },
      });
      return;
    }

    // If expired, Hotel Admin can only access subscription billing/renew/profile endpoints
    if (req.user?.role === 'HOTEL_ADMIN') {
      const allowedPaths = ['/subscription', '/payments/subscribe', '/profile', '/dashboard'];
      const isBillingPath = allowedPaths.some((p) => req.path.includes(p));

      if (!isBillingPath) {
        res.status(403).json({
          success: false,
          errorCode: 'SUBSCRIPTION_EXPIRED',
          message: 'Your 30-day free trial or subscription has expired. Please renew your plan to continue hotel operations.',
          subscriptionStatus: 'EXPIRED',
          trialEndDate,
          supportContact: {
            phone: '+91 98765 43210',
            email: 'support@cloudhotelier.com',
            whatsapp: '+919876543210',
          },
        });
        return;
      }
    }
  }

  next();
};
