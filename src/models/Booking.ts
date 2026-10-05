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
    name?: string;
    age?: number;
    gender?: 'Male' | 'Female' | 'Other';
    relationship?: string;
    email?: string;
    mobileNumber?: string;
    phone?: string;
    idType?: string;
    idNumber?: string;
    frontImage?: string;
    backImage?: string;
  }>;
  
  // Financial Breakdown
  baseAmount: number;
  taxAmount: number;
  gstRate?: number;
  cgstRate?: number;
  sgstRate?: number;
  gstAmount?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  taxableAmount?: number;
  taxInclusive?: boolean;
  roomGstBreakdown?: any[];
  discountAmount: number;
  securityDepositAmount?: number;
  extraChargesTotal: number;
  lateCheckoutCharge?: number;
  lateCheckoutHours?: number;
  lateCheckoutMinutes?: number;
  lateCheckoutType?: 'hourly' | 'full_day' | 'none';
  hourlyRate?: number;
  dailyRoomRate?: number;
  gracePeriodMinutes?: number;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;

  status: BookingStatus;
  guestSignature?: string;
  guestSignedAt?: Date;
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
        name: { type: String, default: 'Guest Member', trim: true },
        age: { type: Number },
        gender: { type: String, enum: ['Male', 'Female', 'Other'], default: 'Male' },
        relationship: { type: String, default: 'Family' },
        email: { type: String, default: '' },
        mobileNumber: { type: String, default: '' },
        phone: { type: String, default: '' },
        idType: { type: String, default: 'AADHAAR' },
        idNumber: { type: String, default: '' },
        frontImage: { type: String, default: '' },
        backImage: { type: String, default: '' },
      },
    ],
    baseAmount: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    gstRate: { type: Number, default: 18 },
    cgstRate: { type: Number, default: 9 },
    sgstRate: { type: Number, default: 9 },
    gstAmount: { type: Number, default: 0 },
    cgstAmount: { type: Number, default: 0 },
    sgstAmount: { type: Number, default: 0 },
    igstAmount: { type: Number, default: 0 },
    taxableAmount: { type: Number, default: 0 },
    taxInclusive: { type: Boolean, default: false },
    roomGstBreakdown: { type: Array, default: [] },
    discountAmount: { type: Number, default: 0, min: 0 },
    securityDepositAmount: { type: Number, default: 0, min: 0 },
    extraChargesTotal: { type: Number, default: 0, min: 0 },
    lateCheckoutCharge: { type: Number, default: 0, min: 0 },
    lateCheckoutHours: { type: Number, default: 0 },
    lateCheckoutMinutes: { type: Number, default: 0 },
    lateCheckoutType: { type: String, enum: ['hourly', 'full_day', 'none'], default: 'none' },
    hourlyRate: { type: Number, default: 0 },
    dailyRoomRate: { type: Number, default: 0 },
    gracePeriodMinutes: { type: Number, default: 10 },
    totalAmount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    dueAmount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'],
      default: 'CONFIRMED',
      index: true,
    },
    guestSignature: { type: String, default: '' },
    guestSignedAt: { type: Date },
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
