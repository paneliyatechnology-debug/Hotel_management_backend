import mongoose, { Document, Schema, Model } from 'mongoose';

export interface ISystemSettings extends Document {
  freeTrialValue: number;
  freeTrialUnit: 'hours' | 'days';
}

const systemSettingsSchema = new Schema<ISystemSettings>(
  {
    freeTrialValue: { type: Number, default: 30 },
    freeTrialUnit: { type: String, enum: ['hours', 'days'], default: 'days' },
  },
  { timestamps: true }
);

const SystemSettings: Model<ISystemSettings> = mongoose.model<ISystemSettings>('SystemSettings', systemSettingsSchema);

export default SystemSettings;
