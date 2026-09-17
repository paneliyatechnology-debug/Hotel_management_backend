import express, { Router } from 'express';
import {
  getHotelAdminDashboard,
  getRoomTypes,
  createRoomType,
  deleteRoomType,
  getRooms,
  createRoom,
  updateRoom,
  deleteRoom,
  updateRoomStatus,
  getReceptionists,
  createReceptionist,
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

// Hotel Admin multi-tenant protection
router.use(
  authenticateUser,
  requireRole('HOTEL_ADMIN'),
  requireActiveHotel,
  requireActiveSubscription
);

router.get('/dashboard', getHotelAdminDashboard);

// Room Types & Rooms
router.get('/room-types', getRoomTypes);
router.post('/room-types', createRoomType);
router.delete('/room-types/:id', deleteRoomType);
router.get('/rooms', getRooms);
router.post('/rooms', createRoom);
router.put('/rooms/:id', updateRoom);
router.delete('/rooms/:id', deleteRoom);
router.put('/rooms/:id/status', updateRoomStatus);

// Staff / Receptionists
router.get('/receptionists', getReceptionists);
router.post('/receptionists', createReceptionist);
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

