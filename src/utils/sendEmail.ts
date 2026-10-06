import { dispatchEmail } from '../services/emailService';

export interface EmailOptions {
  email: string;
  subject: string;
  message?: string;
  html?: string;
}

/**
 * Direct Email Dispatcher (Backward-compatible adapter delegating to EmailService)
 * For high throughput non-blocking APIs, prefer queueEmail() from '../queues/emailQueue'.
 */
export const sendEmail = async (options: EmailOptions): Promise<void> => {
  const recipient = options.email?.trim();
  if (!recipient) {
    console.warn('⚠️ [sendEmail] Skipped: No recipient email provided.');
    return;
  }

  await dispatchEmail({
    to: recipient,
    subject: options.subject,
    html: options.html || options.message || '',
    text: options.message,
  });
};

export default sendEmail;
