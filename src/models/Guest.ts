import mongoose, { Document, Schema, Model } from 'mongoose';

export type IdProofType = 'AADHAAR' | 'PASSPORT' | 'DRIVING_LICENSE' | 'VOTER_ID' | 'PAN' | 'OTHER';
export type IdVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface IGuest extends Document {
  hotel: mongoose.Types.ObjectId;
  fullName: string;
  mobileNumber: string;
  email?: string;
  gender: 'Male' | 'Female' | 'Other';
  dateOfBirth?: Date;
  nationality: string;
  address: string;
  city: string;
  state: string;
  country: string;
  emergencyContact?: string;
  idProof: {
    idType: IdProofType;
    idNumber: string;
    frontImage?: string;
    backImage?: string;
    verificationStatus: IdVerificationStatus;
    verifiedBy?: mongoose.Types.ObjectId;
    verifiedAt?: Date;
    verificationNotes?: string;
  };
  totalVisits: number;
  totalSpent: number;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const guestSchema = new Schema<IGuest>(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    fullName: { type: String, required: [true, 'Guest full name is required'], trim: true },
    mobileNumber: { type: String, required: [true, 'Mobile number is required'], trim: true, index: true },
    email: { type: String, lowercase: true, trim: true },
    gender: { type: String, enum: ['Male', 'Female', 'Other'], default: 'Male' },
    dateOfBirth: { type: Date },
    nationality: { type: String, default: 'Indian' },
    address: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    country: { type: String, default: 'India' },
    emergencyContact: { type: String, default: '' },
    idProof: {
      idType: {
        type: String,
        enum: ['AADHAAR', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID', 'PAN', 'OTHER'],
        default: 'AADHAAR',
      },
      idNumber: { type: String, required: true },
      frontImage: { type: String, default: '' },
      backImage: { type: String, default: '' },
      verificationStatus: {
        type: String,
        enum: ['PENDING', 'VERIFIED', 'REJECTED'],
        default: 'PENDING',
        index: true,
      },
      verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      verifiedAt: { type: Date },
      verificationNotes: { type: String, default: '' },
    },
    totalVisits: { type: Number, default: 1 },
    totalSpent: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
  }
);

guestSchema.index({ hotel: 1, mobileNumber: 1 });

const Guest: Model<IGuest> = mongoose.model<IGuest>('Guest', guestSchema);

export default Guest;
