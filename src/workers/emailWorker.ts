import { Worker, Job } from 'bullmq';
import { createRedisConnection } from '../config/redis';
import { dispatchEmail, maskEmail, isValidEmailFormat } from '../services/emailService';
import {
  passwordResetOtpTemplate,
  receptionistCredentialsEmailTemplate,
  hotelApprovedEmailTemplate,
  hotelRejectedEmailTemplate,
  hotelStatusDisabledEmailTemplate,
  hotelReEnabledEmailTemplate,
  paymentReceiptTemplate,
  guestBookingConfirmationTemplate,
} from '../utils/emailTemplates';

export type EmailJobType =
  | 'PASSWORD_RESET_OTP'
  | 'STAFF_CREDENTIALS'
  | 'HOTEL_APPROVED'
  | 'HOTEL_REJECTED'
  | 'HOTEL_STATUS_CHANGED'
  | 'HOTEL_REGISTERED'
  | 'GUEST_BOOKING_CONFIRMATION'
  | 'GUEST_CHECKOUT_RECEIPT'
  | 'HOTEL_ADMIN_PASSWORD_RESET';

export interface EmailJobData {
  type: EmailJobType;
  to: string;
  data: Record<string, any>;
  createdAt?: string;
}

export const EMAIL_QUEUE_NAME = 'email-queue';

/**
 * Builds the subject and HTML body from the job type and payload
 */
export const renderEmailForJob = (
  jobData: EmailJobData
): { subject: string; html: string } => {
  const { type, data } = jobData;

  switch (type) {
    case 'PASSWORD_RESET_OTP':
      return {
        subject: 'Your Password Reset OTP - The Grand Royale',
        html: passwordResetOtpTemplate(data.userName || 'Valued User', data.otp),
      };

    case 'STAFF_CREDENTIALS':
      return {
        subject: `Staff Login Credentials (${data.role || 'Staff'}) - ${data.hotelName || 'The Hotel'}`,
        html: receptionistCredentialsEmailTemplate(data as any),
      };

    case 'HOTEL_APPROVED':
      return {
        subject: `🎉 Congratulations! ${data.hotelName} Approved - Your Admin Credentials`,
        html: hotelApprovedEmailTemplate(data as any),
      };

    case 'HOTEL_REGISTERED':
      return {
        subject: `🎉 Congratulations! ${data.hotelName} Registered - Your Admin Credentials`,
        html: hotelApprovedEmailTemplate(data as any),
      };

    case 'HOTEL_REJECTED':
      return {
        subject: `Hotel Registration Status Update: ${data.hotelName}`,
        html: hotelRejectedEmailTemplate(data.hotelName, data.ownerName, data.reason || 'Criteria not met'),
      };

    case 'HOTEL_STATUS_CHANGED':
      if (data.status === 'ACTIVE') {
        return {
          subject: `✅ Good News: Your Hotel Account Has Been Re-Activated - ${data.hotelName}`,
          html: hotelReEnabledEmailTemplate(data.hotelName, data.ownerName),
        };
      }
      return {
        subject: `⚠️ Notice: Your Hotel Account Has Been ${data.status} - ${data.hotelName}`,
        html: hotelStatusDisabledEmailTemplate(data as any),
      };

    case 'GUEST_BOOKING_CONFIRMATION':
      return {
        subject: `🏨 Stay Confirmation & Pass - Room #${data.roomNumbers || ''} at ${data.hotelName || 'The Hotel'}`,
        html: guestBookingConfirmationTemplate(data as any),
      };

    case 'GUEST_CHECKOUT_RECEIPT':
      return {
        subject: `Invoice & Checkout Settlement - ${data.hotelName || 'The Hotel'}`,
        html: paymentReceiptTemplate(data as any),
      };

    case 'HOTEL_ADMIN_PASSWORD_RESET':
      return {
        subject: `Your Hotel Admin Password Has Been Reset - ${data.hotelName}`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 25px; background: #0f172a; color: #fff; border-radius: 8px; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #f59e0b; margin-top: 0;">Password Reset Notification</h2>
            <p>Your password for Hotel Admin account at <strong>${data.hotelName}</strong> was reset by Super Administrator.</p>
            <div style="background: #1e293b; padding: 15px; border-radius: 6px; margin: 15px 0;">
              <p style="margin: 0; color: #94a3b8;">New Temporary Password: <strong style="color: #34d399; font-family: monospace; font-size: 16px;">${data.temporaryPassword}</strong></p>
            </div>
            <p style="font-size: 12px; color: #94a3b8; margin-bottom: 0;">You will be asked to create a new password on your next login.</p>
          </div>
        `,
      };

    default:
      throw new Error(`Unsupported email job type: '${type}'`);
  }
};

/**
 * Core Job Processor (used by both BullMQ Worker and In-Memory Queue)
 */
export const processEmailJob = async (jobData: EmailJobData): Promise<void> => {
  if (!isValidEmailFormat(jobData.to)) {
    // Non-retryable error: fail permanently without retrying
    throw new Error(`Non-retryable error: Invalid email format '${maskEmail(jobData.to)}'`);
  }

  const { subject, html } = renderEmailForJob(jobData);

  await dispatchEmail({
    to: jobData.to,
    subject,
    html,
  });
};

let bullWorker: Worker | null = null;

/**
 * Initialize and start the BullMQ Email Worker
 */
export const startEmailWorker = (): Worker => {
  if (bullWorker) {
    return bullWorker;
  }

  const connection = createRedisConnection();

  bullWorker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobData>) => {
      console.log(`⏳ [EmailWorker] Processing job ${job.id} (Type: ${job.data.type}, To: ${maskEmail(job.data.to)})`);
      await processEmailJob(job.data);
    },
    {
      connection,
      concurrency: 5,
    }
  );

  bullWorker.on('completed', (job: Job<EmailJobData>) => {
    console.log(`✅ [EmailWorker] Job ${job.id} completed successfully (Type: ${job.data.type})`);
  });

  bullWorker.on('failed', (job: Job<EmailJobData> | undefined, err: Error) => {
    if (job) {
      const attempts = job.attemptsMade;
      const maxAttempts = job.opts.attempts || 3;
      if (attempts < maxAttempts) {
        console.warn(`🔄 [EmailWorker] Job ${job.id} failed (Attempt ${attempts}/${maxAttempts}). Retrying with backoff... Reason: ${err.message}`);
      } else {
        console.error(`❌ [EmailWorker] Job ${job.id} PERMANENTLY failed after ${attempts} attempts. Reason: ${err.message}`);
      }
    } else {
      console.error(`❌ [EmailWorker] Job failed: ${err.message}`);
    }
  });

  bullWorker.on('error', (err: any) => {
    if (err?.code !== 'ECONNREFUSED') {
      console.warn('⚠️ [EmailWorker] Worker connection issue:', err?.message || err);
    }
  });

  console.log('🚀 [EmailWorker] BullMQ Email Worker initialized and listening for jobs.');
  return bullWorker;
};

/**
 * Gracefully shut down the BullMQ Worker
 */
export const stopEmailWorker = async (): Promise<void> => {
  if (bullWorker) {
    await bullWorker.close();
    bullWorker = null;
    console.log('🛑 [EmailWorker] BullMQ Email Worker closed gracefully.');
  }
};

// If executed directly as standalone process (e.g. npm run worker)
if (require.main === module) {
  startEmailWorker();
}
