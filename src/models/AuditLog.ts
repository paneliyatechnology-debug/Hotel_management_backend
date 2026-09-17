import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IAuditLog extends Document {
  hotel?: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  userName: string;
  userRole: string;
  action: string; // e.g. HOTEL_APPROVED, HOTEL_DISABLED, GUEST_CHECKED_IN, PAYMENT_COLLECTED
  module: string; // e.g. HOTELS, BOOKINGS, PAYMENTS, STAFF, ROOMS
  entityId?: string;
  oldValue?: any;
  newValue?: any;
  ipAddress?: string;
  timestamp: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userName: { type: String, required: true },
    userRole: { type: String, required: true },
    action: { type: String, required: true, index: true },
    module: { type: String, required: true, index: true },
    entityId: { type: String, default: '' },
    oldValue: { type: Schema.Types.Mixed },
    newValue: { type: Schema.Types.Mixed },
    ipAddress: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
  }
);

auditLogSchema.index({ hotel: 1, timestamp: -1 });

const AuditLog: Model<IAuditLog> = mongoose.model<IAuditLog>('AuditLog', auditLogSchema);

export default AuditLog;
