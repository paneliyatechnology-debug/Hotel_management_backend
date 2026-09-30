import mongoose, { Document, Schema, Model } from 'mongoose';

export type TrialRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ITrialRequest extends Document {
  hotel: mongoose.Types.ObjectId;
  requestedBy: mongoose.Types.ObjectId;
  hotelName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  requestedDays: number;
  reason: string;
  status: TrialRequestStatus;
  adminRemarks?: string;
  createdAt: Date;
  updatedAt: Date;
}

const trialRequestSchema = new Schema<ITrialRequest>(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    hotelName: { type: String, required: true },
    ownerName: { type: String, required: true },
    ownerEmail: { type: String, required: true, lowercase: true },
    ownerPhone: { type: String, default: '' },
    requestedDays: { type: Number, default: 30 },
    reason: { type: String, required: [true, 'Please provide a reason for trial extension request'] },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },
    adminRemarks: { type: String, default: '' },
  },
  { timestamps: true }
);

const TrialRequest: Model<ITrialRequest> =
  mongoose.models.TrialRequest || mongoose.model<ITrialRequest>('TrialRequest', trialRequestSchema);

export default TrialRequest;
