import mongoose, { Document, Schema, Model } from 'mongoose';

export type ChargeType = 'ROOM_SERVICE' | 'LAUNDRY' | 'MINI_BAR' | 'EXTRA_BED' | 'EXTRA_GUEST' | 'DAMAGE' | 'OTHER';

export interface IBookingCharge extends Document {
  hotel: mongoose.Types.ObjectId;
  booking: mongoose.Types.ObjectId;
  guest: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  type: ChargeType;
  title: string;
  amount: number;
  quantity: number;
  totalAmount: number;
  date: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const bookingChargeSchema = new Schema<IBookingCharge>(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    guest: { type: Schema.Types.ObjectId, ref: 'Guest', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['ROOM_SERVICE', 'LAUNDRY', 'MINI_BAR', 'EXTRA_BED', 'EXTRA_GUEST', 'DAMAGE', 'OTHER'],
      default: 'ROOM_SERVICE',
    },
    title: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    quantity: { type: Number, default: 1, min: 1 },
    totalAmount: { type: Number, required: true, min: 0 },
    date: { type: Date, default: Date.now },
    notes: { type: String, default: '' },
  },
  {
    timestamps: true,
  }
);

const BookingCharge: Model<IBookingCharge> = mongoose.model<IBookingCharge>('BookingCharge', bookingChargeSchema);

export default BookingCharge;
