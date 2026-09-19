import dotenv from 'dotenv';

// 1. Email Options Interface
export interface EmailOptions {
  email: string;       // Recipient email address
  subject: string;     // Email Subject
  message?: string;    // Plain Text Message (Optional)
  html?: string;       // Rich HTML Message / Template
}

/**
 * 🚀 High-Reliability Brevo Email Dispatcher (Cloud Optimized for Railway & Render)
 * - Uses HTTPS REST API over Port 443 (Never blocked by cloud firewalls)
 * - Sends to ANY email address with NO domain restriction
 * - Includes Terminal Backup Logger so OTPs are always visible in logs
 */
export const sendEmail = async (options: EmailOptions): Promise<void> => {
  dotenv.config();

  const recipient = options.email?.trim();
  if (!recipient) {
    console.warn('⚠️ [sendEmail] Skipped: No recipient email provided.');
    return;
  }

  const brevoApiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || process.env.FROM_EMAIL || 'jatinkakadiya01@gmail.com';
  const senderName = process.env.FROM_NAME || 'The Grand Royale Hotel';

  if (brevoApiKey) {
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': brevoApiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: [{ email: recipient }],
          subject: options.subject,
          htmlContent: options.html || options.message || '',
          textContent: options.message || undefined,
        }),
      });

      const resData: any = await response.json().catch(() => ({}));
      if (response.ok) {
        console.log(`🚀 [Brevo API] Email successfully delivered via Port 443 to: ${recipient} (Message ID: ${resData?.messageId})`);
        return;
      }
      console.warn('⚠️ [Brevo API] Delivery issue:', resData);
    } catch (brevoErr: any) {
      console.warn('⚠️ [Brevo API] Connection exception:', brevoErr?.message);
    }
  } else {
    console.warn('⚠️ [sendEmail] BREVO_API_KEY is not configured in .env file.');
  }

  // Fallback Terminal Log for OTP / Tokens (ensures developers/admins never get blocked in development or server logs)
  const content = options.html || options.message || '';
  const otpMatch = content.match(/\b\d{4,6}\b/);
  if (otpMatch) {
    console.log(`🔑 ==========================================`);
    console.log(`🔑 [SERVER CONSOLE BACKUP] OTP Code for ${recipient}: ${otpMatch[0]}`);
    console.log(`🔑 Subject: ${options.subject}`);
    console.log(`🔑 ==========================================`);
  }
};

export default sendEmail;
