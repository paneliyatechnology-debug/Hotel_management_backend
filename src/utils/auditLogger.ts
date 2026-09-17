import AuditLog from '../models/AuditLog';
import { IUser } from '../models/User';

interface LogOptions {
  user: IUser;
  action: string;
  module: string;
  hotelId?: any;
  entityId?: string;
  oldValue?: any;
  newValue?: any;
  ipAddress?: string;
}

export const logAuditAction = async (options: LogOptions): Promise<void> => {
  try {
    const hotel = options.hotelId || options.user.hotel;
    await AuditLog.create({
      hotel: hotel || undefined,
      user: options.user._id,
      userName: options.user.name,
      userRole: options.user.role,
      action: options.action,
      module: options.module,
      entityId: options.entityId || '',
      oldValue: options.oldValue,
      newValue: options.newValue,
      ipAddress: options.ipAddress || '',
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.error('Audit log failed to record:', error.message);
  }
};

export default logAuditAction;
