import mongoose, { Document, Schema, Model } from 'mongoose';
import bcrypt from 'bcryptjs';

export type UserRole = 'SUPER_ADMIN' | 'HOTEL_ADMIN' | 'RECEPTIONIST' | 'MANAGER' | 'HOUSEKEEPING' | 'ACCOUNTANT';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'BLOCKED' | 'DELETED';

export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  phone?: string;
  role: UserRole;
  hotel?: mongoose.Types.ObjectId; // Empty only for SUPER_ADMIN
  employeeId?: string;
  status: UserStatus;
  mustChangePassword: boolean;
  lastLoginAt?: Date;
  passwordChangedAt?: Date;
  failedLoginAttempts: number;
  accountLockedUntil?: Date;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  matchPassword(enteredPassword: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true },
    email: { type: String, required: [true, 'Email is required'], unique: true, lowercase: true, trim: true },
    password: { type: String, required: [true, 'Password is required'], minlength: 6 },
    phone: { type: String, default: '' },
    role: {
      type: String,
      enum: ['SUPER_ADMIN', 'HOTEL_ADMIN', 'RECEPTIONIST', 'MANAGER', 'HOUSEKEEPING', 'ACCOUNTANT'],
      required: true,
      default: 'HOTEL_ADMIN',
      index: true,
    },
    hotel: {
      type: Schema.Types.ObjectId,
      ref: 'Hotel',
      index: true,
      required: function (this: IUser) {
        return this.role !== 'SUPER_ADMIN'; // SUPER_ADMIN does not belong to a single hotel
      },
    },
    employeeId: { type: String, default: '' },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'BLOCKED', 'DELETED'],
      default: 'ACTIVE',
      index: true,
    },
    mustChangePassword: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
    passwordChangedAt: { type: Date },
    failedLoginAttempts: { type: Number, default: 0 },
    accountLockedUntil: { type: Date },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
userSchema.pre<IUser>('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password
userSchema.methods.matchPassword = async function (enteredPassword: string): Promise<boolean> {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User: Model<IUser> = mongoose.model<IUser>('User', userSchema);

export default User;
