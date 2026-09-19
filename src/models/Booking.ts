import mongoose, { Document, Schema, Model } from 'mongoose';

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW';

export interface IBooking extends Document {
  hotel: mongoose.Types.ObjectId;
  bookingNumber: string;
  guest: mongoose.Types.ObjectId;
  room: mongoose.Types.ObjectId;
  rooms?: mongoose.Types.ObjectId[];
  roomNumber?: string;
  roomNumbers?: string[];
  roomType: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  checkInDate: Date;
  checkOutDate: Date;
  checkInTime?: string;
  checkOutTime?: string;
  actualCheckIn?: Date;
  actualCheckOut?: Date;
  numberOfNights: number;
  guestsCount: {
    adults: number;
    children: number;
  };
  accompanyingGuests?: Array<{
    name: string;
    age?: number;
    gender?: 'Male' | 'Female' | 'Other';
    relationship?: string;
    idType?: string;
    idNumber?: string;
    frontImage?: string;
  }>;
  
  // Financial Breakdown
  baseAmount: number;
  taxAmount: number;
  discountAmount: number;
  securityDepositAmount?: number;
  extraChargesTotal: number;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;

  status: BookingStatus;
  specialRequests?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const bookingSchema = new Schema<IBooking>(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    bookingNumber: { type: String, required: true, unique: true },
    guest: { type: Schema.Types.ObjectId, ref: 'Guest', required: true, index: true },
    room: { type: Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
    rooms: [{ type: Schema.Types.ObjectId, ref: 'Room' }],
    roomNumber: { type: String },
    roomNumbers: [{ type: String }],
    roomType: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    checkInDate: { type: Date, required: true },
    checkOutDate: { type: Date, required: true },
    checkInTime: { type: String, default: '14:00' },
    checkOutTime: { type: String, default: '12:00' },
    actualCheckIn: { type: Date },
    actualCheckOut: { type: Date },
    numberOfNights: { type: Number, required: true, min: 1 },
    guestsCount: {
      adults: { type: Number, default: 1, min: 1 },
      children: { type: Number, default: 0, min: 0 },
    },
    accompanyingGuests: [
      {
        name: { type: String, required: true, trim: true },
        age: { type: Number },
        gender: { type: String, enum: ['Male', 'Female', 'Other'], default: 'Male' },
        relationship: { type: String, default: 'Family' },
        idType: { type: String, default: 'AADHAAR' },
        idNumber: { type: String, default: '' },
        frontImage: { type: String, default: '' },
      },
    ],
    baseAmount: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    securityDepositAmount: { type: Number, default: 0, min: 0 },
    extraChargesTotal: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    dueAmount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'],
      default: 'CONFIRMED',
      index: true,
    },
    specialRequests: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  {
    timestamps: true,
  }
);

bookingSchema.index({ hotel: 1, checkInDate: 1, checkOutDate: 1 });

const Booking: Model<IBooking> = mongoose.model<IBooking>('Booking', bookingSchema);

export default Booking;
