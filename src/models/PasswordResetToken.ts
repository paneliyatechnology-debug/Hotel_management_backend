import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IPasswordResetToken extends Document {
  user: mongoose.Types.ObjectId;
  token: string;
  otp?: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

const passwordResetTokenSchema = new Schema<IPasswordResetToken>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token: { type: String, required: true },
    otp: { type: String },
    expiresAt: { type: Date, required: true, index: { expires: '15m' } },
    used: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

const PasswordResetToken: Model<IPasswordResetToken> = mongoose.model<IPasswordResetToken>(
  'PasswordResetToken',
  passwordResetTokenSchema
);

export default PasswordResetToken;
