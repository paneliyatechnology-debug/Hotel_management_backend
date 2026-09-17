import mongoose, { Document, Schema, Model } from 'mongoose';

export type PaymentMethod = 'CASH' | 'ONLINE' | 'CARD' | 'UPI' | 'BANK_TRANSFER';
export type PaymentType = 'ADVANCE' | 'PARTIAL' | 'FULL_SETTLEMENT' | 'EXTRA_CHARGE' | 'REFUND';
export type PaymentStatus = 'PAID' | 'PARTIALLY_PAID' | 'FAILED' | 'REFUNDED';

export interface IPayment extends Document {
  hotel: mongoose.Types.ObjectId;
  booking: mongoose.Types.ObjectId;
  guest: mongoose.Types.ObjectId;
  collectedBy: mongoose.Types.ObjectId; // User (Receptionist/Admin)
  receiptNumber: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentType: PaymentType;
  paymentStatus: PaymentStatus;
  drawerSettlementStatus?: 'UNSETTLED' | 'SETTLED_TO_ADMIN';
  settledAt?: Date;
  settledBy?: mongoose.Types.ObjectId;
  transactionId?: string;
  paymentGateway?: string;
  paymentReference?: string;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    guest: { type: Schema.Types.ObjectId, ref: 'Guest', required: true, index: true },
    collectedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receiptNumber: { type: String, required: true, unique: true },
    amount: { type: Number, required: true, min: 0 },
    paymentMethod: {
      type: String,
      enum: ['CASH', 'ONLINE', 'CARD', 'UPI', 'BANK_TRANSFER'],
      default: 'CASH',
      index: true,
    },
    paymentType: {
      type: String,
      enum: ['ADVANCE', 'PARTIAL', 'FULL_SETTLEMENT', 'EXTRA_CHARGE', 'REFUND'],
      default: 'FULL_SETTLEMENT',
    },
    paymentStatus: {
      type: String,
      enum: ['PAID', 'PARTIALLY_PAID', 'FAILED', 'REFUNDED'],
      default: 'PAID',
      index: true,
    },
    drawerSettlementStatus: {
      type: String,
      enum: ['UNSETTLED', 'SETTLED_TO_ADMIN'],
      default: 'UNSETTLED',
      index: true,
    },
    settledAt: { type: Date },
    settledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    transactionId: { type: String, default: '' },
    paymentGateway: { type: String, default: '' },
    paymentReference: { type: String, default: '' },
    note: { type: String, default: '' },
  },
  {
    timestamps: true,
  }
);

paymentSchema.index({ hotel: 1, createdAt: -1 });

const Payment: Model<IPayment> = mongoose.model<IPayment>('Payment', paymentSchema);

export default Payment;
