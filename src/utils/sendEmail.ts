import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

// 1. Email Options Interface
export interface EmailOptions {
  email: string;       // જેને મેઈલ મોકલવાનો છે તે
  subject: string;     // ઈમેલનો વિષય (Subject)
  message?: string;    // સાદો ટેક્સ્ટ (Optional)
  html?: string;       // 👈 તમે કંટ્રોલરમાંથી જે પણ HTML/UI મોકલશો તે અહીં આવશે!
}

// 2. Main sendEmail Function
export const sendEmail = async (options: EmailOptions): Promise<void> => {
  dotenv.config();

  const user = (process.env.SMTP_EMAIL || 'jatinkakadiya01@gmail.com').trim();
  const pass = (process.env.SMTP_PASSWORD || 'edvhnjyfzsjduscd').replace(/\s+/g, '');

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: user,
      pass: pass,
    },
    connectionTimeout: 4000,
    greetingTimeout: 4000,
    socketTimeout: 4000,
  });

  const mailOptions = {
    from: `"${process.env.FROM_NAME || 'The Grand Royale Hotel'}" <${user}>`,
    to: options.email.trim(),
    subject: options.subject,
    text: options.message,
    html: options.html || options.message, // જો HTML આપ્યું હોય તો HTML જશે, નહીંતર text
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`📧 Email UI sent to: ${options.email} (ID: ${info.messageId})`);
};

export default sendEmail;
