import mongoose, { Document, Schema, Model } from 'mongoose';

export type BillingCycle = 'MONTHLY' | 'ANNUAL';

export interface ISubscriptionPlan extends Document {
  name: string;
  code: string;
  billingCycle: BillingCycle;
  price: number;
  discountPercent: number;
  maxRooms: number;
  description: string;
  features: string[];
  badge?: string;
  isPopular?: boolean;
  isActive: boolean;
  isDeleted: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionPlanSchema = new Schema<ISubscriptionPlan>(
  {
    name: { type: String, required: [true, 'Plan name is required'], trim: true },
    code: { type: String, required: [true, 'Plan code is required'], uppercase: true, trim: true },
    billingCycle: {
      type: String,
      enum: ['MONTHLY', 'ANNUAL'],
      required: [true, 'Billing cycle (MONTHLY or ANNUAL) is required'],
      index: true,
    },
    price: { type: Number, required: [true, 'Price is required'], min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    maxRooms: { type: Number, default: 50 },
    description: { type: String, default: '', trim: true },
    features: { type: [String], default: [] },
    badge: { type: String, default: '', trim: true },
    isPopular: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    isDeleted: { type: Boolean, default: false, index: true },
    displayOrder: { type: Number, default: 1 },
  },
  {
    timestamps: true,
  }
);

subscriptionPlanSchema.index({ billingCycle: 1, isDeleted: 1, isActive: 1 });

const SubscriptionPlan: Model<ISubscriptionPlan> = mongoose.model<ISubscriptionPlan>('SubscriptionPlan', subscriptionPlanSchema);

export default SubscriptionPlan;
