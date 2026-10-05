import Room from '../models/Room';
import { emitToHotel } from './socketService';

/**
 * Automatically transitions rooms from CLEANING to AVAILABLE
 * when their cleaningDurationMinutes turnaround window has elapsed (100% complete).
 */
export const autoCompleteExpiredCleaningRooms = async (hotelId?: any): Promise<number> => {
  try {
    const query: any = {
      status: 'CLEANING',
      isActive: true,
      isDeleted: { $ne: true },
    };
    if (hotelId) {
      query.hotel = hotelId;
    }

    const cleaningRooms = await Room.find(query);
    if (!cleaningRooms || cleaningRooms.length === 0) return 0;

    const now = Date.now();
    const roomsToMakeAvailable: any[] = [];
    const hotelIdsToNotify = new Set<string>();

    for (const room of cleaningRooms) {
      const startedAt = room.cleaningStartedAt
        ? new Date(room.cleaningStartedAt).getTime()
        : new Date(room.updatedAt || Date.now()).getTime();
      const durationMs = (room.cleaningDurationMinutes || 15) * 60 * 1000;

      if (now - startedAt >= durationMs) {
        roomsToMakeAvailable.push(room._id);
        if (room.hotel) {
          hotelIdsToNotify.add(room.hotel.toString());
        }
      }
    }

    if (roomsToMakeAvailable.length > 0) {
      await Room.updateMany(
        { _id: { $in: roomsToMakeAvailable } },
        {
          $set: {
            status: 'AVAILABLE',
          },
          $unset: {
            cleaningStartedAt: 1,
          },
        }
      );

      // Emit real-time WebSocket events to update all connected dashboards
      hotelIdsToNotify.forEach((hId) => {
        emitToHotel(hId, 'ROOM_UPDATED', { message: 'Housekeeping cleaning 100% complete. Rooms are now AVAILABLE.' });
        emitToHotel(hId, 'DASHBOARD_SYNC', { type: 'HOUSEKEEPING_AUTO_COMPLETED' });
      });
    }

    return roomsToMakeAvailable.length;
  } catch (err) {
    console.error('Housekeeping auto-complete check error:', err);
    return 0;
  }
};
