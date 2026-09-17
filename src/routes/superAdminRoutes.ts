import express, { Router } from 'express';
import {
  getSuperAdminDashboard,
  getAllHotels,
  getHotelDetails,
  approveHotel,
  rejectHotel,
  updateHotelStatus,
  extendTrialOrSubscription,
  resetHotelAdminPassword,
  getSuperAdminAuditLogs,
} from '../controllers/superAdminController';
import {
  getSuperAdminSubscriptionPlans,
  createSubscriptionPlan,
  updateSubscriptionPlan,
  deleteSubscriptionPlan,
  resetDefaultSubscriptionPlans,
} from '../controllers/subscriptionPlanController';
import { authenticateUser, requireRole } from '../middleware/authMiddleware';

const router: Router = express.Router();

// Guard all Super Admin routes
router.use(authenticateUser, requireRole('SUPER_ADMIN'));

router.get('/dashboard', getSuperAdminDashboard);
router.get('/hotels', getAllHotels);
router.get('/hotels/:id', getHotelDetails);
router.put('/hotels/:id/approve', approveHotel);
router.put('/hotels/:id/reject', rejectHotel);
router.put('/hotels/:id/status', updateHotelStatus);
router.put('/hotels/:id/extend-trial', extendTrialOrSubscription);
router.put('/hotels/:id/reset-admin-password', resetHotelAdminPassword);
router.get('/audit-logs', getSuperAdminAuditLogs);

// Subscription Plans Management (Max 3 Monthly + 3 Annual = 6 Plans)
router.get('/subscription-plans', getSuperAdminSubscriptionPlans);
router.post('/subscription-plans', createSubscriptionPlan);
router.put('/subscription-plans/:id', updateSubscriptionPlan);
router.delete('/subscription-plans/:id', deleteSubscriptionPlan);
router.post('/subscription-plans/reset-defaults', resetDefaultSubscriptionPlans);

export default router;

