import express, { Router } from 'express';
import {
  loginUser,
  logoutUser,
  changePassword,
  forgotPassword,
  resetPasswordWithOtp,
  getMe,
} from '../controllers/authController';
import { authenticateUser } from '../middleware/authMiddleware';

const router: Router = express.Router();

router.post('/login', loginUser);
router.post('/logout', logoutUser);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPasswordWithOtp);

// Protected Auth Routes
router.put('/change-password', authenticateUser, changePassword);
router.get('/me', authenticateUser, getMe);

export default router;
