import mongoose from 'mongoose';
import Booking from '../models/Booking';
import Room from '../models/Room';

/**
 * Formats a Date or string to 'YYYY-MM-DD' without timezone distortion
 */
export const toISODateString = (dateInput?: string | Date | number | null): string => {
  if (!dateInput) return '';
  if (typeof dateInput === 'string') {
    const match = dateInput.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Formats a Date to a human readable short string e.g. "22 Oct"
 */
export const formatShortDate = (dateInput?: string | Date | number | null): string => {
  if (!dateInput) return '';
  const isoStr = toISODateString(dateInput);
  if (!isoStr) return '';
  const [y, m, d] = isoStr.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  return dateObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/**
 * Checks if two date intervals [reqIn, reqOut) and [existIn, existOut) overlap.
 * 
 * CORE PMS RULE:
 * Hotel bookings are night-based inventory.
 * Check-in date is the first night.
 * Check-out date is departure day (not an occupied night).
 * 
 * Overlap condition:
 * (EXISTING CHECK-IN < REQUESTED CHECK-OUT) AND (EXISTING CHECK-OUT > REQUESTED CHECK-IN)
 * 
 * Boundary Cases:
 * If Booking A ends on 21 (Check-out: 21) and Booking B starts on 21 (Check-in: 21),
 * existOut (21) > reqIn (21) is FALSE.
 * Therefore NO OVERLAP -> ALLOWED.
 */
export const isDateRangeOverlapping = (
  reqCheckIn: string | Date | number,
  reqCheckOut: string | Date | number,
  existCheckIn: string | Date | number,
  existCheckOut: string | Date | number
): boolean => {
  const rIn = toISODateString(reqCheckIn);
  const rOut = toISODateString(reqCheckOut);
  const eIn = toISODateString(existCheckIn);
  const eOut = toISODateString(existCheckOut);

  if (!rIn || !rOut || !eIn || !eOut) return false;
  return eIn < rOut && eOut > rIn;
};

/**
 * Finds all active bookings that overlap with the requested [checkInDate, checkOutDate)
 * for a specific room or list of rooms.
 */
export const findOverlappingBookings = async ({
  hotelId,
  roomIds,
  checkInDate,
  checkOutDate,
  excludeBookingId,
}: {
  hotelId: any;
  roomIds: (string | mongoose.Types.ObjectId)[];
  checkInDate: string | Date | number;
  checkOutDate: string | Date | number;
  excludeBookingId?: string | mongoose.Types.ObjectId;
}) => {
  const rInStr = toISODateString(checkInDate);
  const rOutStr = toISODateString(checkOutDate);

  if (!rInStr || !rOutStr || !roomIds || roomIds.length === 0) return [];

  const objectIds = roomIds
    .map((id) => (typeof id === 'string' && mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : id))
    .filter(Boolean);

  const roomDocs = await Room.find({ _id: { $in: objectIds }, hotel: hotelId });
  const roomNumbers = roomDocs.map((r) => String(r.roomNumber)).filter(Boolean);

  // Active bookings that occupy date slots (exclude CANCELLED and CHECKED_OUT)
  const query: any = {
    hotel: hotelId,
    status: { $nin: ['CANCELLED', 'CHECKED_OUT', 'NO_SHOW', 'VOID', 'REFUNDED'] },
    isDeleted: { $ne: true },
    $or: [
      { room: { $in: objectIds } },
      { rooms: { $in: objectIds } },
      ...(roomNumbers.length > 0 ? [{ roomNumber: { $in: roomNumbers } }, { roomNumbers: { $in: roomNumbers } }] : []),
    ],
  };

  if (excludeBookingId) {
    query._id = { $ne: excludeBookingId };
  }

  const activeBookings = await Booking.find(query)
    .populate('guest', 'fullName mobileNumber')
    .populate('room', 'roomNumber');

  // Filter with strict date range overlap formula
  return activeBookings.filter((b) => {
    return isDateRangeOverlapping(rInStr, rOutStr, b.checkInDate, b.checkOutDate);
  });
};
