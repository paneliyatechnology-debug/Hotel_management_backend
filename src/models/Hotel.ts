import mongoose, { Document, Schema, Model } from 'mongoose';

export type HotelStatus = 'PENDING_APPROVAL' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED' | 'EXPIRED' | 'REJECTED';
export type SubscriptionPlanType = 'TRIAL' | 'BASIC' | 'STANDARD' | 'PREMIUM';
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'PAYMENT_PENDING' | 'CANCELLED';

export interface IHotel extends Document {
  name: string;
  slug: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  address: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  gstNumber?: string;
  panNumber?: string;
  totalRooms: number;
  hotelType: string;
  website?: string;
  logo?: string;
  idProofDocument?: string;
  businessProofDocument?: string;
  status: HotelStatus;
  statusReason?: string; // Reason why hotel is disabled or suspended
  rejectionReason?: string;
  
  // Subscription & Trial Details
  subscription: {
    plan: SubscriptionPlanType;
    status: SubscriptionStatus;
    trialStartDate: Date;
    trialEndDate: Date;
    subscriptionStartDate?: Date;
    subscriptionEndDate?: Date;
    gracePeriodUntil?: Date;
    autoRenew: boolean;
  };

  // Hotel Profile & Settings
  settings: {
    checkInTime: string;
    checkOutTime: string;
    timezone: string;
    currency: string;
    taxPercentage: number;
    upiId?: string;
    bankDetails?: {
      bankName?: string;
      accountNumber?: string;
      ifscCode?: string;
      beneficiaryName?: string;
    };
    amenities: string[];
    policies: string[];
  };

  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const hotelSchema = new Schema<IHotel>(
  {
    name: { type: String, required: [true, 'Hotel name is required'], trim: true },
    slug: { type: String, unique: true, lowercase: true, trim: true },
    ownerName: { type: String, required: [true, 'Owner name is required'], trim: true },
    ownerEmail: { type: String, required: [true, 'Owner email is required'], unique: true, lowercase: true, trim: true },
    ownerPhone: { type: String, required: [true, 'Owner phone is required'], trim: true },
    address: { type: String, required: [true, 'Hotel address is required'] },
    city: { type: String, required: true },
    state: { type: String, required: true },
    country: { type: String, default: 'India' },
    pincode: { type: String, required: true },
    gstNumber: { type: String, default: '' },
    panNumber: { type: String, default: '' },
    totalRooms: { type: Number, default: 0 },
    hotelType: { type: String, default: 'Boutique Hotel' },
    website: { type: String, default: '' },
    logo: { type: String, default: '' },
    idProofDocument: { type: String, default: '' },
    businessProofDocument: { type: String, default: '' },
    status: {
      type: String,
      enum: ['PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'DISABLED', 'EXPIRED', 'REJECTED'],
      default: 'ACTIVE',
      index: true,
    },
    statusReason: { type: String, default: '' },
    rejectionReason: { type: String, default: '' },
    subscription: {
      plan: {
        type: String,
        enum: ['TRIAL', 'BASIC', 'STANDARD', 'PREMIUM'],
        default: 'TRIAL',
      },
      status: {
        type: String,
        enum: ['TRIAL', 'ACTIVE', 'EXPIRED', 'PAYMENT_PENDING', 'CANCELLED'],
        default: 'TRIAL',
        index: true,
      },
      trialStartDate: { type: Date, default: Date.now },
      trialEndDate: {
        type: Date,
        default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      subscriptionStartDate: { type: Date },
      subscriptionEndDate: { type: Date },
      gracePeriodUntil: { type: Date },
      autoRenew: { type: Boolean, default: true },
    },
    settings: {
      checkInTime: { type: String, default: '14:00' },
      checkOutTime: { type: String, default: '12:00' },
      timezone: { type: String, default: 'Asia/Kolkata' },
      currency: { type: String, default: 'INR' },
      taxPercentage: { type: Number, default: 0 },
      upiId: { type: String, default: 'jatinkakadiya234-1@okicici' },
      bankDetails: {
        bankName: { type: String, default: '' },
        accountNumber: { type: String, default: '' },
        ifscCode: { type: String, default: '' },
        beneficiaryName: { type: String, default: '' },
      },
      amenities: { type: [String], default: ['Free WiFi', '24/7 Room Service', 'Air Conditioning'] },
      policies: { type: [String], default: ['Valid Government ID required at check-in', 'No smoking in standard rooms'] },
    },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
  }
);

hotelSchema.pre<IHotel>('save', function (next) {
  if (this.isModified('name') || !this.slug) {
    this.slug =
      this.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') +
      '-' +
      Math.floor(1000 + Math.random() * 9000);
  }
  next();
});

const Hotel: Model<IHotel> = mongoose.model<IHotel>('Hotel', hotelSchema);

export default Hotel;
