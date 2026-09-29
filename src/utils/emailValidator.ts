import User from '../models/User';
import Guest from '../models/Guest';
import Hotel from '../models/Hotel';
import Booking from '../models/Booking';

export const checkEmailExistsGlobally = async (
  email: string,
  excludeId?: string,
  excludeModel?: 'User' | 'Guest' | 'Hotel' | 'Booking'
): Promise<boolean> => {
  if (!email || typeof email !== 'string') return false;
  
  const cleanEmail = email.toLowerCase().trim();
  if (!cleanEmail) return false;

  // Check User collection
  let userQuery: any = { email: cleanEmail };
  if (excludeModel === 'User' && excludeId) userQuery._id = { $ne: excludeId };
  if (await User.exists(userQuery)) return true;

  // Check Hotel collection (ownerEmail)
  let hotelQuery: any = { ownerEmail: cleanEmail };
  if (excludeModel === 'Hotel' && excludeId) hotelQuery._id = { $ne: excludeId };
  if (await Hotel.exists(hotelQuery)) return true;

  // Check Guest collection
  let guestQuery: any = { email: cleanEmail };
  if (excludeModel === 'Guest' && excludeId) guestQuery._id = { $ne: excludeId };
  if (await Guest.exists(guestQuery)) return true;

  // Check Booking collection (additionalGuests array)
  let bookingQuery: any = { 'additionalGuests.email': cleanEmail };
  if (excludeModel === 'Booking' && excludeId) bookingQuery._id = { $ne: excludeId };
  if (await Booking.exists(bookingQuery)) return true;

  return false;
};
