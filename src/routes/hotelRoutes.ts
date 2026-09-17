import express, { Router } from 'express';
import { registerHotel } from '../controllers/hotelController';

const router: Router = express.Router();

// Public Hotel Registration
router.post('/register', registerHotel);

export default router;
