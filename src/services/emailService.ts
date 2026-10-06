import nodemailer, { Transporter } from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  provider: 'SMTP' | 'BREVO';
}

/**
 * Safely mask an email address for privacy in logs (e.g. j***n@example.com)
 */
export const maskEmail = (email: string): string => {
  if (!email || !email.includes('@')) return 'unknown';
  const [local, domain] = email.split('@');
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
};

/**
 * Validates strict email syntax
 */
export const isValidEmailFormat = (email: string): boolean => {
  if (!email || typeof email !== 'string') return false;
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email.trim());
};

// Singleton Nodemailer Transporter
let cachedTransporter: Transporter | null = null;

const getSmtpTransporter = (): Transporter => {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  const senderUser = (process.env.SMTP_USER || process.env.SMTP_EMAIL || '').trim();
  const senderPass = (process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '').replace(/\s+/g, '');
  const port = Number(process.env.SMTP_PORT) || 465;

  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: {
      user: senderUser,
      pass: senderPass,
    },
    pool: true, // Reuse connections for speed
    maxConnections: 5,
    maxMessages: 100,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
  });

  return cachedTransporter;
};

/**
 * Primary Engine: Send via Nodemailer SMTP
 */
const sendViaSmtp = async (payload: EmailPayload): Promise<EmailResult> => {
  const transporter = getSmtpTransporter();
  const senderName = process.env.FROM_NAME || 'The Grand Royale Hotel';
  const senderEmail = process.env.SMTP_USER || process.env.SMTP_EMAIL || process.env.FROM_EMAIL || 'no-reply@hotelier.com';

  const mailOptions = {
    from: payload.from || `"${senderName}" <${senderEmail}>`,
    to: payload.to.trim(),
    subject: payload.subject,
    text: payload.text || undefined,
    html: payload.html,
  };

  const info = await transporter.sendMail(mailOptions);
  return {
    success: true,
    messageId: info.messageId,
    provider: 'SMTP',
  };
};

/**
 * Fallback Engine: Send via Brevo HTTPS REST API (Port 443)
 */
const sendViaBrevo = async (payload: EmailPayload): Promise<EmailResult> => {
  const brevoApiKey = process.env.BREVO_API_KEY;
  if (!brevoApiKey) {
    throw new Error('Brevo API key not configured in environment variables (BREVO_API_KEY).');
  }

  const senderName = process.env.FROM_NAME || 'The Grand Royale Hotel';
  const brevoSender = process.env.BREVO_SENDER_EMAIL || process.env.FROM_EMAIL || 'no-reply@hotelier.com';

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': brevoApiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: senderName, email: brevoSender },
      to: [{ email: payload.to.trim() }],
      subject: payload.subject,
      htmlContent: payload.html,
      textContent: payload.text || undefined,
    }),
  });

  const resData: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMsg = resData?.message || `Brevo HTTP error status: ${response.status}`;
    throw new Error(`Brevo dispatch failed: ${errorMsg}`);
  }

  return {
    success: true,
    messageId: resData?.messageId,
    provider: 'BREVO',
  };
};

/**
 * Core Dispatcher: High-Reliability Dual-Engine Dispatcher
 * Automatically tries SMTP first, then falls back to Brevo API.
 */
export const dispatchEmail = async (payload: EmailPayload): Promise<EmailResult> => {
  const recipient = payload.to?.trim();
  if (!recipient || !isValidEmailFormat(recipient)) {
    throw new Error(`Invalid recipient email address format: '${maskEmail(recipient)}'`);
  }

  let lastError: Error | null = null;

  // 1. Try SMTP First
  const hasSmtpConfig = Boolean(process.env.SMTP_USER || process.env.SMTP_EMAIL);
  if (hasSmtpConfig) {
    try {
      const result = await sendViaSmtp(payload);
      console.log(`📧 [EmailService] SMTP delivered to: ${maskEmail(recipient)} (ID: ${result.messageId})`);
      return result;
    } catch (smtpErr: any) {
      lastError = smtpErr;
      console.warn(`⚠️ [EmailService] SMTP attempt failed (${smtpErr?.message || 'Error'}). Falling back to Brevo...`);
    }
  }

  // 2. Try Brevo REST API Fallback
  const hasBrevoConfig = Boolean(process.env.BREVO_API_KEY);
  if (hasBrevoConfig) {
    try {
      const result = await sendViaBrevo(payload);
      console.log(`🚀 [EmailService] Brevo API delivered to: ${maskEmail(recipient)} (ID: ${result.messageId})`);
      return result;
    } catch (brevoErr: any) {
      lastError = brevoErr;
      console.warn(`⚠️ [EmailService] Brevo API fallback failed (${brevoErr?.message || 'Error'}).`);
    }
  }

  // If no providers are configured or both failed:
  if (!hasSmtpConfig && !hasBrevoConfig) {
    throw new Error('No email provider configured. Please set SMTP_USER/SMTP_PASSWORD or BREVO_API_KEY.');
  }

  throw lastError || new Error('Email delivery failed on all available engines (SMTP & Brevo).');
};

export default {
  dispatchEmail,
  maskEmail,
  isValidEmailFormat,
};
