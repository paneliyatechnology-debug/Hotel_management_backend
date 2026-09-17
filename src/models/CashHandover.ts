import mongoose, { Document, Schema, Model } from 'mongoose';

export interface ICashHandover extends Document {
  hotel: mongoose.Types.ObjectId;
  settledByAdmin: mongoose.Types.ObjectId;
  handoverCode: string;
  cashAmount: number;
  upiAmount: number;
  cardAmount: number;
  bankAmount: number;
  totalSettledAmount: number;
  paymentsCount: number;
  settledPaymentIds: mongoose.Types.ObjectId[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const cashHandoverSchema = new Schema<ICashHandover>(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    settledByAdmin: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    handoverCode: { type: String, required: true, unique: true },
    cashAmount: { type: Number, required: true, default: 0 },
    upiAmount: { type: Number, default: 0 },
    cardAmount: { type: Number, default: 0 },
    bankAmount: { type: Number, default: 0 },
    totalSettledAmount: { type: Number, required: true },
    paymentsCount: { type: Number, default: 0 },
    settledPaymentIds: [{ type: Schema.Types.ObjectId, ref: 'Payment' }],
    notes: { type: String, default: 'Daily Cash Drawer Handover to Hotel Admin' },
  },
  {
    timestamps: true,
  }
);

cashHandoverSchema.index({ hotel: 1, createdAt: -1 });

const CashHandover: Model<ICashHandover> = mongoose.model<ICashHandover>('CashHandover', cashHandoverSchema);

export default CashHandover;
