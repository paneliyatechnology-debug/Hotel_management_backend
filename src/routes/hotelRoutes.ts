import express, { Router } from 'express';
import { registerHotel } from '../controllers/hotelController';
import { submitTrialRequest } from '../controllers/trialRequestController';
import { authenticateUser, requireRole } from '../middleware/authMiddleware';

const router: Router = express.Router();

// Public Hotel Registration
router.post('/register', registerHotel);

// Request Trial Extension (Hotel Admin)
router.post(
  '/request-trial-extension',
  authenticateUser,
  requireRole('HOTEL_ADMIN'),
  submitTrialRequest
);

export default router;

