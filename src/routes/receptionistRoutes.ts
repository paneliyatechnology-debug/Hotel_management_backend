import express, { Router } from 'express';
import {
  getReceptionistDashboard,
  getAvailableRooms,
  registerGuest,
  verifyGuestId,
  createBookingOrCheckIn,
  addBookingCharge,
  processCheckOut,
  getGuestsList,
  deleteGuest,
  getBookingsList,
  lookupGuest,
  getPaymentsLedger,
  recordDirectPayment,
} from '../controllers/receptionistController';
import { updateRoomStatus } from '../controllers/hotelAdminController';
import {
  authenticateUser,
  requireRole,
  requireActiveHotel,
  requireActiveSubscription,
} from '../middleware/authMiddleware';

const router: Router = express.Router();

// Receptionist & Hotel Admin operational access
router.use(
  authenticateUser,
  requireRole('RECEPTIONIST', 'HOTEL_ADMIN'),
  requireActiveHotel,
  requireActiveSubscription
);

router.get('/dashboard', getReceptionistDashboard);
router.get('/rooms/available', getAvailableRooms);
router.put('/rooms/:id/status', updateRoomStatus);

// Guests & ID Proof Verification
router.get('/guests/lookup', lookupGuest);
router.get('/guests', getGuestsList);
router.post('/guests', registerGuest);
router.delete('/guests/:id', deleteGuest);
router.put('/guests/:id/verify-id', verifyGuestId);

// Bookings, Check-In, Extra Charges & Check-Out
router.get('/bookings', getBookingsList);
router.post('/bookings', createBookingOrCheckIn);
router.post('/bookings/:id/charges', addBookingCharge);
router.post('/bookings/:id/check-out', processCheckOut);

// Payment Collections & Cash Drawer Ledger
router.get('/payments', getPaymentsLedger);
router.post('/payments', recordDirectPayment);

export default router;

