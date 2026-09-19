import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { Resend } from 'resend';

// 1. Email Options Interface
export interface EmailOptions {
  email: string;       // Recipient email address
  subject: string;     // Email Subject
  message?: string;    // Plain Text Message (Optional)
  html?: string;       // Rich HTML Message / Template
}

/**
 * 🚀 High-Reliability Hybrid Email Dispatcher (Railway & Render Cloud Optimized)
 * 1. Primary: Resend HTTPS REST API (Port 443 - NEVER blocked by Railway/Render firewalls)
 * 2. Secondary: Nodemailer Gmail/SMTP with strict 3.5s connection timeout
 * 3. Fallback: Cloud Server Terminal Audit Logger (Ensures OTP/Tokens are never lost)
 */
export const sendEmail = async (options: EmailOptions): Promise<void> => {
  dotenv.config();

  const recipient = options.email?.trim();
  if (!recipient) {
    console.warn('⚠️ [sendEmail] Skipped: No recipient email provided.');
    return;
  }

  // 1. Check for Resend API Key (Best for Cloud Deployments like Render / Railway)
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    try {
      const resend = new Resend(resendApiKey);
      const fromEmail = process.env.RESEND_FROM || process.env.FROM_EMAIL || 'Grand Royale <onboarding@resend.dev>';
      
      const res = await resend.emails.send({
        from: fromEmail,
        to: recipient,
        subject: options.subject,
        text: options.message,
        html: options.html || options.message || '',
      });

      if (!res.error) {
        console.log(`🚀 [Resend API] Email delivered via Port 443 to: ${recipient} (ID: ${res.data?.id})`);
        return;
      }
      console.warn('⚠️ [Resend API] Error, falling back to SMTP:', res.error);
    } catch (resendErr: any) {
      console.warn('⚠️ [Resend API] Exception, attempting SMTP fallback:', resendErr?.message);
    }
  }

  // 2. Secondary: Nodemailer SMTP with strict connection timeouts
  const user = (process.env.SMTP_EMAIL || 'jatinkakadiya01@gmail.com').trim();
  const pass = (process.env.SMTP_PASSWORD || 'edvhnjyfzsjduscd').replace(/\s+/g, '');

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 465,
      secure: Number(process.env.SMTP_PORT) === 465 || !process.env.SMTP_PORT, // true for 465, false for 587
      auth: {
        user: user,
        pass: pass,
      },
      connectionTimeout: 3500, // Strict 3.5s timeout prevents API hanging on Render/Railway
      greetingTimeout: 3500,
      socketTimeout: 3500,
    });

    const mailOptions = {
      from: `"${process.env.FROM_NAME || 'The Grand Royale Hotel'}" <${user}>`,
      to: recipient,
      subject: options.subject,
      text: options.message,
      html: options.html || options.message || '',
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 [Nodemailer SMTP] Email sent to: ${recipient} (ID: ${info.messageId})`);
  } catch (smtpErr: any) {
    console.error(`❌ [Email Delivery Notice] SMTP blocked or timed out on cloud network (${smtpErr?.message || 'Network Timeout'}).`);
    
    // 3. Fallback Terminal Log for OTP / Tokens (so developer/admin can instantly see it in Render/Railway logs)
    const content = options.html || options.message || '';
    const otpMatch = content.match(/\b\d{4,6}\b/);
    if (otpMatch) {
      console.log(`🔑 ==========================================`);
      console.log(`🔑 [CLOUD SERVER BACKUP] OTP Code for ${recipient}: ${otpMatch[0]}`);
      console.log(`🔑 Subject: ${options.subject}`);
      console.log(`🔑 ==========================================`);
    }
  }
};

export default sendEmail;
