import express, { Router } from 'express';
import {
  getHotelAdminDashboard,
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
import { getPaymentsLedger, recordDirectPayment } from '../controllers/receptionistController';
import {
  authenticateUser,
  requireRole,
  requireActiveHotel,
  requireActiveSubscription,
} from '../middleware/authMiddleware';

const router: Router = express.Router();

// Hotel Admin & Receptionist operational access
router.use(
  authenticateUser,
  requireRole('HOTEL_ADMIN', 'RECEPTIONIST'),
  requireActiveHotel,
  requireActiveSubscription
);

router.get('/dashboard', requireRole('HOTEL_ADMIN'), getHotelAdminDashboard);

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

// Staff / Receptionists (Admin only)
router.get('/receptionists', requireRole('HOTEL_ADMIN'), getReceptionists);
router.post('/receptionists', requireRole('HOTEL_ADMIN'), createReceptionist);
router.put('/receptionists/:id', requireRole('HOTEL_ADMIN'), updateReceptionist);
router.delete('/receptionists/:id', requireRole('HOTEL_ADMIN'), deleteReceptionist);
router.put('/receptionists/:id/status', requireRole('HOTEL_ADMIN'), updateReceptionistStatus);

// Payments & Financial Ledger
router.get('/payments', getPaymentsLedger);
router.post('/payments', recordDirectPayment);

// Daily Collections, Shift Settlement & Handover
router.get('/daily-collections', getDailyCollectionsReconciliation);
router.post('/daily-collections/handover', settleCashDrawerHandover);

// Profile & Reports (Admin only)
router.get('/profile', requireRole('HOTEL_ADMIN'), getHotelProfile);
router.put('/profile', requireRole('HOTEL_ADMIN'), updateHotelProfile);
router.get('/reports', requireRole('HOTEL_ADMIN'), getHotelReports);

export default router;

