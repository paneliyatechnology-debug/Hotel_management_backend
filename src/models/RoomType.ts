import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IRoomType extends Document {
  hotel: mongoose.Types.ObjectId;
  name: string; // e.g. Deluxe Suite, Presidential Suite
  description: string;
  basePrice: number;
  capacity: {
    adults: number;
    children: number;
  };
  bedCount?: number;
  bedType?: string;
  amenities: string[];
  images: string[];
  isActive: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const roomTypeSchema = new Schema<IRoomType>(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    name: { type: String, required: [true, 'Room type name is required'], trim: true },
    description: { type: String, default: '' },
    basePrice: { type: Number, required: [true, 'Base price per night is required'], min: 0 },
    capacity: {
      adults: { type: Number, default: 2, min: 1 },
      children: { type: Number, default: 1, min: 0 },
    },
    bedCount: { type: Number, default: 1 },
    bedType: { type: String, default: '1 King Bed' },
    amenities: { type: [String], default: ['Free WiFi', 'LED TV', 'Mini Fridge', 'Attached Bathroom'] },
    images: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
  }
);

roomTypeSchema.index({ hotel: 1, name: 1 }, { unique: true });

const RoomType: Model<IRoomType> = mongoose.model<IRoomType>('RoomType', roomTypeSchema);

export default RoomType;
