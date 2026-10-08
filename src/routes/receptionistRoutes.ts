import express, { Router } from 'express';
import {
  getReceptionistDashboard,
  getAvailableRooms,
  getBookingRoomOptions,
  registerGuest,
  verifyGuestId,
  createBookingOrCheckIn,
  addBookingCharge,
  processCheckOut,
  getGuestsList,
  getGuestDetailsById,
  getGuestPdfUrl,
  deleteGuest,
  getBookingsList,
  lookupGuest,
  getPaymentsLedger,
  recordDirectPayment,
  ocrVerifyGovtId,
  directVerifyDrivingLicense,
  saveGuestSignature,
  saveBookingSignature,
} from '../controllers/receptionistController';
import {
  getRoomTypes,
  createRoom,
  updateRoom,
  deleteRoom,
  updateRoomStatus,
  getDailyCollectionsReconciliation,
  settleCashDrawerHandover,
} from '../controllers/hotelAdminController';
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
router.get('/room-types', getRoomTypes);
router.get('/booking/room-options', getBookingRoomOptions);
router.delete('/rooms/:id', deleteRoom);
router.put('/rooms/:id/status', updateRoomStatus);

// Guests & ID Proof Verification
router.get('/guests/lookup', lookupGuest);
router.get('/guests', getGuestsList);
router.get('/guests/:id/pdf', getGuestPdfUrl);
router.get('/guests/:id/folio-pdf', getGuestPdfUrl);
router.get('/guests/:id', getGuestDetailsById);
router.post('/guests', registerGuest);
router.delete('/guests/:id', deleteGuest);
router.put('/guests/:id/verify-id', verifyGuestId);
router.post('/guests/:id/signature', saveGuestSignature);

// Surepass Zero-OTP KYC OCR & Automated Verification
router.post('/kyc/ocr-verify', ocrVerifyGovtId);
router.post('/kyc/verify-driving-license', directVerifyDrivingLicense);

// Bookings, Check-In, Extra Charges & Check-Out
router.get('/bookings', getBookingsList);
router.post('/bookings', createBookingOrCheckIn);
router.post('/bookings/:id/charges', addBookingCharge);
router.post('/bookings/:id/check-out', processCheckOut);
router.post('/bookings/:id/signature', saveBookingSignature);

// Payment Collections & Cash Drawer Ledger
router.get('/payments', getPaymentsLedger);
router.post('/payments', recordDirectPayment);

// Daily Collections, Shift Settlement & Handover
router.get('/daily-collections', getDailyCollectionsReconciliation);
router.post('/daily-collections/handover', settleCashDrawerHandover);

export default router;

