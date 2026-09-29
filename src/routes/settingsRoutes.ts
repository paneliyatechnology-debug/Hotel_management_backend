import express from 'express';
import { getSettings, updateSettings } from '../controllers/settingsController';
import { authenticateUser, requireRole } from '../middleware/authMiddleware';

const router = express.Router();

// Public route to fetch settings for the frontend website
router.get('/', getSettings);

// Super Admin route to update settings
router.put('/', authenticateUser, requireRole('SUPER_ADMIN'), updateSettings);

export default router;
