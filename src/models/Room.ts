import mongoose, { Document, Schema, Model } from 'mongoose';

export type RoomStatus = 'AVAILABLE' | 'RESERVED' | 'OCCUPIED' | 'CLEANING' | 'MAINTENANCE' | 'BLOCKED';

export interface IRoom extends Document {
  hotel: mongoose.Types.ObjectId;
  roomNumber: string;
  roomType: mongoose.Types.ObjectId;
  floor: number;
  status: RoomStatus;
  seatingCapacity?: number;
  customPricePerNight?: number;
  notes?: string;
  cleaningStartedAt?: Date;
  cleaningDurationMinutes?: number;
  isActive: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const roomSchema = new Schema<IRoom>(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    roomNumber: { type: String, required: [true, 'Room number is required'], trim: true },
    roomType: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true, index: true },
    floor: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ['AVAILABLE', 'RESERVED', 'OCCUPIED', 'CLEANING', 'MAINTENANCE', 'BLOCKED'],
      default: 'AVAILABLE',
      index: true,
    },
    seatingCapacity: { type: Number, default: 2 },
    customPricePerNight: { type: Number },
    notes: { type: String, default: '' },
    cleaningStartedAt: { type: Date },
    cleaningDurationMinutes: { type: Number, default: 15 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
  }
);

roomSchema.index({ hotel: 1, roomNumber: 1 }, { unique: true });

const Room: Model<IRoom> = mongoose.model<IRoom>('Room', roomSchema);

export default Room;
