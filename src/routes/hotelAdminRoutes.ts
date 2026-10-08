import express, { Router } from 'express';
import {
  getHotelAdminDashboard,
  getRevenueDetails,
  getRoomTypes,
  createRoomType,
  updateRoomType,
  deleteRoomType,
  getRooms,
  createRoom,
  updateRoom,
  deleteRoom,
  updateRoomStatus,
  getReceptionists,
  createReceptionist,
  updateReceptionist,
  deleteReceptionist,
  updateReceptionistStatus,
  getHotelProfile,
  updateHotelProfile,
  getHotelReports,
  getDailyCollectionsReconciliation,
  settleCashDrawerHandover,
} from '../controllers/hotelAdminController';
import { getPaymentsLedger, recordDirectPayment, getGuestsList, getGuestDetailsById, getGuestPdfUrl } from '../controllers/receptionistController';
import {
  authenticateUser,
  requireRole,
  requireActiveHotel,
  requireActiveSubscription,
} from '../middleware/authMiddleware';

const router: Router = express.Router();

// Hotel Admin operational access
router.use(
  authenticateUser,
  requireRole('HOTEL_ADMIN'),
  requireActiveHotel,
  requireActiveSubscription
);

router.get('/dashboard', getHotelAdminDashboard);
router.get('/revenue-details', getRevenueDetails);
router.get('/guests', getGuestsList);
router.get('/guests/:id/pdf', getGuestPdfUrl);
router.get('/guests/:id/folio-pdf', getGuestPdfUrl);
router.get('/guests/:id', getGuestDetailsById);

// Room Types & Rooms
router.get('/room-types', getRoomTypes);
router.post('/room-types', createRoomType);
router.put('/room-types/:id', updateRoomType);
router.delete('/room-types/:id', deleteRoomType);
router.get('/rooms', getRooms);
router.post('/rooms', createRoom);
router.put('/rooms/:id', updateRoom);
router.delete('/rooms/:id', deleteRoom);
router.put('/rooms/:id/status', updateRoomStatus);

// Staff / Receptionists
router.get('/receptionists', getReceptionists);
router.post('/receptionists', createReceptionist);
router.put('/receptionists/:id', updateReceptionist);
router.delete('/receptionists/:id', deleteReceptionist);
router.put('/receptionists/:id/status', updateReceptionistStatus);

// Payments & Financial Ledger
router.get('/payments', getPaymentsLedger);
router.post('/payments', recordDirectPayment);

// Daily Collections, Shift Settlement & Handover
router.get('/daily-collections', getDailyCollectionsReconciliation);
router.post('/daily-collections/handover', settleCashDrawerHandover);

// Profile & Reports
router.get('/profile', getHotelProfile);
router.put('/profile', updateHotelProfile);
router.get('/reports', getHotelReports);

export default router;

