// 🏨 Multi-Tenant Hotel Management System Professional Email Templates

const BASE_STYLES = `
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  max-width: 600px;
  margin: 0 auto;
  background: #0f172a;
  color: #f8fafc;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid #334155;
`;

const DEFAULT_ADMIN_URL = process.env.ADMIN_URL || 'https://hotel-management-admin-livid.vercel.app';

// 🌟 Reusable Personalized Poster / Hero Card Generator
const renderPosterBanner = ({
  badge,
  name,
  hotelName,
  tagline,
  colorTheme = 'gold',
}: {
  badge: string;
  name: string;
  hotelName: string;
  tagline?: string;
  colorTheme?: 'gold' | 'emerald' | 'cyan' | 'red';
}): string => {
  const themes = {
    gold: {
      bg: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 50%, #2e1065 100%)',
      border: '#f59e0b',
      badgeBg: 'rgba(245, 158, 11, 0.15)',
      badgeBorder: '#f59e0b',
      badgeColor: '#fbbf24',
      nameColor: '#f59e0b',
      shadow: '0 8px 24px rgba(245, 158, 11, 0.25)',
    },
    emerald: {
      bg: 'linear-gradient(135deg, #064e3b 0%, #0f172a 50%, #022c22 100%)',
      border: '#10b981',
      badgeBg: 'rgba(16, 185, 129, 0.15)',
      badgeBorder: '#10b981',
      badgeColor: '#34d399',
      nameColor: '#34d399',
      shadow: '0 8px 24px rgba(16, 185, 129, 0.25)',
    },
    cyan: {
      bg: 'linear-gradient(135deg, #0c4a6e 0%, #0f172a 50%, #1e3a8a 100%)',
      border: '#38bdf8',
      badgeBg: 'rgba(56, 189, 248, 0.15)',
      badgeBorder: '#38bdf8',
      badgeColor: '#38bdf8',
      nameColor: '#38bdf8',
      shadow: '0 8px 24px rgba(56, 189, 248, 0.25)',
    },
    red: {
      bg: 'linear-gradient(135deg, #450a0a 0%, #0f172a 50%, #2a0808 100%)',
      border: '#ef4444',
      badgeBg: 'rgba(239, 68, 68, 0.15)',
      badgeBorder: '#ef4444',
      badgeColor: '#fca5a5',
      nameColor: '#fca5a5',
      shadow: '0 8px 24px rgba(239, 68, 68, 0.25)',
    },
  };
  const current = themes[colorTheme] || themes.gold;

  return `
    <!-- 🌟 VIP ACCESS POSTER 🌟 -->
    <div style="background: ${current.bg}; border: 2px solid ${current.border}; border-radius: 14px; padding: 24px 18px; text-align: center; margin: 15px 0 22px 0; box-shadow: ${current.shadow};">
      <div style="display: inline-block; background: ${current.badgeBg}; border: 1px solid ${current.badgeBorder}; border-radius: 20px; padding: 4px 16px; margin-bottom: 10px;">
        <span style="color: ${current.badgeColor}; font-size: 11px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase;">
          ✨ ${badge}
        </span>
      </div>
      <div style="color: #94a3b8; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 4px;">
        OFFICIAL PASS ISSUED TO
      </div>
      <h1 style="color: #ffffff; margin: 0 0 6px 0; font-size: 25px; font-weight: 900; letter-spacing: -0.5px;">
        <span style="color: ${current.nameColor}; border-bottom: 2px dashed ${current.border}; padding-bottom: 2px;">
          ${name}
        </span>
      </h1>
      <div style="color: #e2e8f0; font-size: 15px; font-weight: 800; margin-top: 6px;">
        🏨 ${hotelName}
      </div>
      ${
        tagline
          ? `
        <div style="display: inline-block; margin-top: 8px; font-size: 12px; color: #cbd5e1; background: rgba(255,255,255,0.08); padding: 4px 14px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1);">
          ${tagline}
        </div>
      `
          : ''
      }
    </div>
  `;
};

// 1. Hotel Registration Received (Pending Approval)
export const hotelRegistrationReceivedTemplate = (hotelName: string, ownerName: string): string => {
  return `
    <div style="${BASE_STYLES}">
      <div style="background: linear-gradient(135deg, #1e293b, #0f172a); border-bottom: 2px solid #f59e0b; padding: 25px; text-align: center;">
        <h2 style="color: #f59e0b; margin: 0; font-size: 22px;">🏨 Hotel Registration Received</h2>
        <p style="color: #94a3b8; margin: 5px 0 0; font-size: 13px;">The Grand Royale SaaS Platform</p>
      </div>
      <div style="padding: 25px;">
        ${renderPosterBanner({
          badge: 'REGISTRATION PENDING APPROVAL',
          name: ownerName,
          hotelName,
          tagline: 'Application Under Review by Super Administrator',
          colorTheme: 'gold',
        })}

        <p style="color: #cbd5e1; font-size: 15px; line-height: 1.6;">
          Thank you for registering <strong>${hotelName}</strong> on our Multi-Tenant Hotel Management Platform.
        </p>
        <div style="background: #1e293b; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 6px;">
          <p style="margin: 0; color: #94a3b8; font-size: 14px;">
            ⏳ <strong>Status:</strong> PENDING APPROVAL<br/>
            Our Super Admin team is reviewing your hotel business details and documents. You will receive your admin login credentials immediately upon verification.
          </p>
        </div>
      </div>
      <div style="background: #090d16; padding: 15px; text-align: center; font-size: 12px; color: #64748b;">
        © 2026 Hotel Management SaaS Cloud &bull; Support: support@hotelmgmt.com
      </div>
    </div>
  `;
};

// 2. Hotel Approved & 30-Day Trial Started (With Temporary Credentials)
export const hotelApprovedEmailTemplate = (data: {
  hotelName: string;
  ownerName: string;
  adminEmail: string;
  temporaryPassword: string;
  loginUrl: string;
  trialStartDate: string;
  trialEndDate: string;
}): string => {
  const portalUrl = data.loginUrl || DEFAULT_ADMIN_URL;

  return `
    <div style="${BASE_STYLES}">
      <div style="background: linear-gradient(135deg, #065f46, #047857); padding: 28px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px;">🎉 Hotel Registration Approved!</h1>
        <p style="color: #a7f3d0; margin: 6px 0 0; font-weight: 600;">Welcome to The Grand Royale SaaS Platform</p>
      </div>
      <div style="padding: 28px;">
        ${renderPosterBanner({
          badge: '🎉 30-DAY FREE TRIAL ACTIVATED',
          name: data.ownerName,
          hotelName: data.hotelName,
          tagline: 'Hotel Administrator &bull; Full Access Enabled',
          colorTheme: 'emerald',
        })}

        <p style="color: #cbd5e1; font-size: 15px; line-height: 1.6;">
          Your hotel <strong>${data.hotelName}</strong> has been successfully approved! Your <strong>30-Day FREE TRIAL</strong> has officially started.
        </p>

        <!-- Credentials Box -->
        <div style="background: #1e293b; border: 1px solid #334155; padding: 20px; margin: 20px 0; border-radius: 10px;">
          <h4 style="color: #f59e0b; margin-top: 0;">🔑 Your Hotel Admin Credentials</h4>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="color: #94a3b8; padding: 8px 0; font-size: 14px;">Portal URL:</td>
              <td style="color: #38bdf8; padding: 8px 0; font-weight: bold;"><a href="${portalUrl}" style="color: #38bdf8; text-decoration: underline;">${portalUrl}</a></td>
            </tr>
            <tr>
              <td style="color: #94a3b8; padding: 8px 0; font-size: 14px;">Login Email:</td>
              <td style="color: #f8fafc; padding: 8px 0; font-weight: bold;">${data.adminEmail}</td>
            </tr>
            <tr>
              <td style="color: #94a3b8; padding: 8px 0; font-size: 14px;">Temporary Password:</td>
              <td style="color: #34d399; padding: 8px 0; font-family: monospace; font-size: 16px; font-weight: bold;">${data.temporaryPassword}</td>
            </tr>
            <tr>
              <td style="color: #94a3b8; padding: 8px 0; font-size: 14px;">Free Trial Active:</td>
              <td style="color: #fbbf24; padding: 8px 0; font-weight: 600;">${data.trialStartDate} to ${data.trialEndDate}</td>
            </tr>
          </table>
        </div>

        <div style="background: rgba(239, 68, 68, 0.1); border-left: 4px solid #ef4444; padding: 12px; margin-bottom: 25px; border-radius: 6px;">
          <p style="margin: 0; color: #fca5a5; font-size: 13px;">
            ⚠️ <strong>Security Notice:</strong> You will be prompted to change your temporary password upon your first login.
          </p>
        </div>

        <div style="text-align: center;">
          <a href="${portalUrl}" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: #0f172a; font-weight: 900; text-decoration: none; padding: 14px 38px; border-radius: 8px; display: inline-block; font-size: 15px; box-shadow: 0 4px 14px rgba(245, 158, 11, 0.4);">
            🚀 Login to Hotel Admin Portal
          </a>
        </div>
      </div>
      <div style="background: #090d16; padding: 15px; text-align: center; font-size: 12px; color: #64748b;">
        © 2026 Hotel Management SaaS Cloud &bull; Support: support@hotelmgmt.com
      </div>
    </div>
  `;
};

// 3. Hotel Rejected Notification
export const hotelRejectedEmailTemplate = (hotelName: string, ownerName: string, reason: string): string => {
  return `
    <div style="${BASE_STYLES}">
      <div style="background: #7f1d1d; padding: 25px; text-align: center;">
        <h2 style="color: #ffffff; margin: 0;">Hotel Registration Status Update</h2>
      </div>
      <div style="padding: 25px;">
        ${renderPosterBanner({
          badge: 'REGISTRATION STATUS UPDATE',
          name: ownerName,
          hotelName,
          tagline: 'Application Reviewed by Super Administrator',
          colorTheme: 'red',
        })}

        <p style="color: #cbd5e1;">We regret to inform you that your registration for <strong>${hotelName}</strong> could not be approved at this time.</p>
        <div style="background: #1e293b; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; border-radius: 6px;">
          <strong style="color: #fca5a5;">Reason for rejection:</strong>
          <p style="color: #e2e8f0; margin: 5px 0 0;">${reason}</p>
        </div>
        <p style="color: #94a3b8; font-size: 14px;">If you have any questions or would like to re-submit updated documents, please contact our team at support@hotelmgmt.com.</p>
      </div>
      <div style="background: #090d16; padding: 15px; text-align: center; font-size: 12px; color: #64748b;">
        © 2026 Hotel Management SaaS Cloud
      </div>
    </div>
  `;
};

// 4. Hotel Disabled or Suspended Notification (With Reason)
export const hotelStatusDisabledEmailTemplate = (data: {
  hotelName: string;
  ownerName: string;
  status: string; // DISABLED or SUSPENDED
  reason: string;
}): string => {
  const isSuspended = data.status === 'SUSPENDED';
  const badgeColor = isSuspended ? '#f59e0b' : '#ef4444';
  const title = isSuspended ? 'Hotel Account Temporarily Suspended' : 'Hotel Account Disabled Notice';

  return `
    <div style="${BASE_STYLES}">
      <div style="background: #1e293b; border-bottom: 3px solid ${badgeColor}; padding: 25px; text-align: center;">
        <h2 style="color: ${badgeColor}; margin: 0; font-size: 22px;">⚠️ ${title}</h2>
        <p style="color: #94a3b8; margin: 6px 0 0;">${data.hotelName}</p>
      </div>
      <div style="padding: 25px;">
        ${renderPosterBanner({
          badge: `ACCOUNT ${data.status}`,
          name: data.ownerName,
          hotelName: data.hotelName,
          tagline: `Status: ${data.status}`,
          colorTheme: isSuspended ? 'gold' : 'red',
        })}

        <p style="color: #cbd5e1; font-size: 15px; line-height: 1.6;">
          This is an official notice to inform you that your hotel account for <strong>${data.hotelName}</strong> has been set to <strong>${data.status}</strong> by Super Administrator.
        </p>

        <!-- Reason Box -->
        <div style="background: #1e293b; border-left: 4px solid ${badgeColor}; padding: 18px; margin: 20px 0; border-radius: 6px;">
          <strong style="color: ${badgeColor}; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Reason for Action:</strong>
          <p style="color: #f8fafc; margin: 8px 0 0; font-size: 15px; line-height: 1.5;">
            ${data.reason || 'Policy compliance or administrative review.'}
          </p>
        </div>

        <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid #334155; padding: 15px; border-radius: 6px; margin-bottom: 25px;">
          <p style="margin: 0; color: #94a3b8; font-size: 13px;">
            🔒 <strong>Operational Impact:</strong> All staff logins, room reservations, and front desk check-in capabilities for this hotel have been temporarily halted. Your existing hotel records and data remain safely preserved.
          </p>
        </div>

        <p style="color: #94a3b8; font-size: 14px;">
          To appeal this decision, resolve the issues mentioned above, or re-activate your hotel services, please contact our Super Admin support immediately at <a href="mailto:support@hotelmgmt.com" style="color: #38bdf8;">support@hotelmgmt.com</a>.
        </p>
      </div>
      <div style="background: #090d16; padding: 15px; text-align: center; font-size: 12px; color: #64748b;">
        © 2026 Hotel Management SaaS Cloud &bull; Security & Compliance Team
      </div>
    </div>
  `;
};

// 5. Hotel Re-Enabled / Activated Notification
export const hotelReEnabledEmailTemplate = (hotelName: string, ownerName: string): string => {
  const portalUrl = `${DEFAULT_ADMIN_URL}/login`;

  return `
    <div style="${BASE_STYLES}">
      <div style="background: linear-gradient(135deg, #065f46, #047857); padding: 25px; text-align: center;">
        <h2 style="color: #ffffff; margin: 0;">✅ Hotel Account Re-Activated</h2>
      </div>
      <div style="padding: 25px;">
        ${renderPosterBanner({
          badge: '✅ ACCOUNT RE-ACTIVATED',
          name: ownerName,
          hotelName,
          tagline: 'All Hotel Admin & Front Desk Operations Restored',
          colorTheme: 'emerald',
        })}

        <p style="color: #cbd5e1;">Dear <strong>${ownerName}</strong>,</p>
        <p style="color: #cbd5e1;">We are pleased to inform you that your hotel <strong>${hotelName}</strong> has been re-activated by Super Administrator.</p>
        <p style="color: #34d399; font-weight: bold;">All hotel admin features and front desk operations have been restored to active status.</p>
        <div style="text-align: center; margin-top: 25px;">
          <a href="${portalUrl}" style="background: #10b981; color: #0f172a; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: bold; display: inline-block;">Access Dashboard</a>
        </div>
      </div>
    </div>
  `;
};

// 6. Receptionist Account Created (With Credentials)
export const receptionistCredentialsEmailTemplate = (data: {
  hotelName: string;
  receptionistName: string;
  email: string;
  temporaryPassword: string;
  employeeId?: string;
  loginUrl: string;
}): string => {
  const portalUrl = data.loginUrl || `${DEFAULT_ADMIN_URL}/login`;

  return `
    <div style="${BASE_STYLES}">
      <div style="background: #1e293b; border-bottom: 2px solid #3b82f6; padding: 25px; text-align: center;">
        <h2 style="color: #38bdf8; margin: 0;">🛎️ Front Desk Receptionist Account Created</h2>
        <p style="color: #94a3b8; margin: 5px 0 0;">${data.hotelName}</p>
      </div>
      <div style="padding: 25px;">
        ${renderPosterBanner({
          badge: '🛎️ FRONT DESK RECEPTIONIST PASS',
          name: data.receptionistName,
          hotelName: data.hotelName,
          tagline: `Staff Member &bull; Employee ID: ${data.employeeId || 'Active'}`,
          colorTheme: 'cyan',
        })}

        <p style="color: #94a3b8; font-size: 14px;">You have been assigned as a Front Desk Receptionist at <strong>${data.hotelName}</strong>. Below are your official login credentials:</p>
        
        <div style="background: #1e293b; border: 1px solid #334155; padding: 18px; border-radius: 10px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="color: #94a3b8; padding: 6px 0; font-size: 14px;">Portal URL:</td>
              <td style="color: #38bdf8; padding: 6px 0; font-weight: bold;"><a href="${portalUrl}" style="color: #38bdf8; text-decoration: underline;">${portalUrl}</a></td>
            </tr>
            <tr>
              <td style="color: #94a3b8; padding: 6px 0; font-size: 14px;">Employee ID:</td>
              <td style="color: #f8fafc; padding: 6px 0; font-weight: bold;">${data.employeeId || 'N/A'}</td>
            </tr>
            <tr>
              <td style="color: #94a3b8; padding: 6px 0; font-size: 14px;">Login Email:</td>
              <td style="color: #f8fafc; padding: 6px 0; font-weight: bold;">${data.email}</td>
            </tr>
            <tr>
              <td style="color: #94a3b8; padding: 6px 0; font-size: 14px;">Temporary Password:</td>
              <td style="color: #34d399; padding: 6px 0; font-family: monospace; font-size: 16px; font-weight: bold;">${data.temporaryPassword}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center; margin-top: 25px;">
          <a href="${portalUrl}" style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: #ffffff; text-decoration: none; padding: 14px 34px; border-radius: 8px; font-weight: bold; display: inline-block; box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);">
            🔑 Login to Front Desk
          </a>
        </div>
      </div>
      <div style="background: #090d16; padding: 15px; text-align: center; font-size: 12px; color: #64748b;">
        © 2026 ${data.hotelName} &bull; Powered by Hotel Management Cloud
      </div>
    </div>
  `;
};

// 7. Password Reset OTP
export const passwordResetOtpTemplate = (userName: string, otp: string): string => {
  return `
    <div style="${BASE_STYLES}">
      <div style="background: #1e293b; border-bottom: 2px solid #f59e0b; padding: 25px; text-align: center;">
        <h2 style="color: #f59e0b; margin: 0;">🔒 Password Reset Request</h2>
      </div>
      <div style="padding: 25px; text-align: center;">
        ${renderPosterBanner({
          badge: '🔒 SECURITY AUTHENTICATION',
          name: userName,
          hotelName: 'The Grand Royale Cloud',
          tagline: 'Authorized Password Reset OTP',
          colorTheme: 'gold',
        })}

        <p style="color: #cbd5e1; font-size: 15px;">Use the OTP code below to reset your password:</p>
        <div style="background: #1e293b; display: inline-block; padding: 15px 35px; border-radius: 10px; border: 2px dashed #f59e0b; margin: 15px auto;">
          <span style="font-size: 32px; font-family: monospace; letter-spacing: 6px; font-weight: bold; color: #f59e0b;">${otp}</span>
        </div>
        <p style="color: #94a3b8; font-size: 13px; margin-top: 15px;">This OTP is valid for 15 minutes. If you did not request this, please ignore this email.</p>
      </div>
    </div>
  `;
};

// 8. Payment & Guest Receipt Template
export const paymentReceiptTemplate = (data: {
  hotelName: string;
  hotelAddress: string;
  hotelGst?: string;
  receiptNumber: string;
  bookingNumber: string;
  guestName: string;
  roomNumber: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  amount: number;
  paymentMethod: string;
  paymentType: string;
  balanceDue: number;
  collectedByName: string;
  date: string;
}): string => {
  return `
    <div style="${BASE_STYLES}">
      <div style="background: #1e293b; border-bottom: 2px solid #10b981; padding: 25px; text-align: center;">
        <h2 style="color: #10b981; margin: 0;">Payment Receipt</h2>
        <p style="color: #f8fafc; font-size: 16px; margin: 5px 0 0; font-weight: bold;">${data.hotelName}</p>
        <p style="color: #94a3b8; font-size: 12px; margin: 2px 0 0;">${data.hotelAddress} ${data.hotelGst ? `&bull; GST: ${data.hotelGst}` : ''}</p>
      </div>
      <div style="padding: 25px;">
        ${renderPosterBanner({
          badge: '🧾 OFFICIAL PAYMENT RECEIPT',
          name: data.guestName,
          hotelName: data.hotelName,
          tagline: `Room #${data.roomNumber} &bull; Booking: ${data.bookingNumber}`,
          colorTheme: 'emerald',
        })}

        <div style="display: flex; justify-content: space-between; margin-bottom: 15px; font-size: 13px; color: #94a3b8;">
          <div>Receipt #: <strong style="color: #f8fafc;">${data.receiptNumber}</strong></div>
          <div>Date: <strong style="color: #f8fafc;">${data.date}</strong></div>
        </div>
        
        <table style="width: 100%; border-collapse: collapse; margin: 15px 0; background: #1e293b; border-radius: 8px; font-size: 14px;">
          <tr style="border-bottom: 1px solid #334155;">
            <td style="padding: 10px 15px; color: #94a3b8;">Guest Name:</td>
            <td style="padding: 10px 15px; color: #f8fafc; text-align: right; font-weight: bold;">${data.guestName}</td>
          </tr>
          <tr style="border-bottom: 1px solid #334155;">
            <td style="padding: 10px 15px; color: #94a3b8;">Booking Ref:</td>
            <td style="padding: 10px 15px; color: #f8fafc; text-align: right;">${data.bookingNumber}</td>
          </tr>
          <tr style="border-bottom: 1px solid #334155;">
            <td style="padding: 10px 15px; color: #94a3b8;">Room:</td>
            <td style="padding: 10px 15px; color: #f8fafc; text-align: right;">Room ${data.roomNumber} (${data.roomType})</td>
          </tr>
          <tr style="border-bottom: 1px solid #334155;">
            <td style="padding: 10px 15px; color: #94a3b8;">Stay Duration:</td>
            <td style="padding: 10px 15px; color: #f8fafc; text-align: right;">${data.checkIn} to ${data.checkOut}</td>
          </tr>
          <tr style="border-bottom: 1px solid #334155;">
            <td style="padding: 10px 15px; color: #94a3b8;">Payment Mode:</td>
            <td style="padding: 10px 15px; color: #38bdf8; text-align: right; font-weight: bold;">${data.paymentMethod} (${data.paymentType})</td>
          </tr>
          <tr style="border-bottom: 1px solid #334155;">
            <td style="padding: 12px 15px; color: #94a3b8; font-size: 15px;">Amount Paid:</td>
            <td style="padding: 12px 15px; color: #10b981; font-size: 18px; font-weight: bold; text-align: right;">₹${data.amount.toLocaleString('en-IN')}</td>
          </tr>
          <tr>
            <td style="padding: 10px 15px; color: #94a3b8;">Balance Remaining:</td>
            <td style="padding: 10px 15px; color: ${data.balanceDue > 0 ? '#ef4444' : '#10b981'}; font-weight: bold; text-align: right;">₹${data.balanceDue.toLocaleString('en-IN')}</td>
          </tr>
        </table>
        
        <p style="font-size: 12px; color: #64748b; text-align: right; margin-top: 10px;">Collected by: <strong>${data.collectedByName}</strong></p>
      </div>
    </div>
  `;
};

// 9. Main Guest Room Booking & Check-In Confirmation (With VIP Poster, Amenities & House Instructions)
export interface GuestBookingEmailData {
  hotelName: string;
  hotelAddress: string;
  hotelPhone?: string;
  hotelEmail?: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  bookingNumber: string;
  roomNumbers: string;
  roomCategory: string;
  bedType?: string;
  checkInDate: string;
  checkInTime: string;
  checkOutDate: string;
  checkOutTime: string;
  numberOfNights: number;
  totalGuests: number;
  adults: number;
  children: number;
  accompanyingMembers?: string[];
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  securityDeposit?: number;
  paymentMethod: string;
  amenities: string[];
  rulesAndInstructions: string[];
  specialRequests?: string;
}

export const guestBookingConfirmationTemplate = (data: GuestBookingEmailData): string => {
  const defaultAmenities = [
    '📶 High-Speed Free Wi-Fi',
    '❄️ Individual Climate Control (AC)',
    '📺 Smart LED Television',
    '☕ Electric Tea & Coffee Maker',
    '🚿 24/7 Hot & Cold Water',
    '🧴 Premium Toiletries & Fresh Towels',
    '🛏️ Orthopedic Mattress & Crisp Linens',
    '🍽️ 24/7 In-Room Dining & Room Service',
  ];

  const finalAmenities = Array.isArray(data.amenities) && data.amenities.length > 0
    ? data.amenities
    : defaultAmenities;

  const defaultInstructions = [
    {
      icon: '⏰',
      title: 'Check-Out Timing (ચેક-આઉટ સમય)',
      desc: 'Standard Check-Out is strictly 12:00 PM (Noon). For late checkout, please coordinate with front desk in advance.',
    },
    {
      icon: '🆔',
      title: 'Government ID Compliance (ઓળખપત્ર)',
      desc: 'Original Government Photo ID is required for all adult guests as per local hospitality regulations.',
    },
    {
      icon: '🚭',
      title: '100% Smoke-Free Rooms (સ્મોકિંગ મનાઈ)',
      desc: 'All indoor guest rooms, bathrooms and corridors are strictly non-smoking zones. Designated outdoor areas are available.',
    },
    {
      icon: '🤫',
      title: 'Quiet Hours (શાંતિ સમય)',
      desc: 'Quiet hours are observed from 10:00 PM to 07:00 AM to ensure peaceful rest for all staying guests.',
    },
    {
      icon: '🔑',
      title: 'Keycard & Room Security (રૂમ સુરક્ષા)',
      desc: 'Please ensure your door is locked properly whenever exiting. Secure lockers are available inside your room.',
    },
    {
      icon: '🍽️',
      title: '24/7 Room Service & Dining (રૂમ સર્વિસ)',
      desc: 'Dial Intercom 9 from your room telephone to order fresh meals, refreshments, snacks, or bottled water.',
    },
    {
      icon: '🧹',
      title: 'Housekeeping & Assistance (હાઉસકીપિંગ)',
      desc: 'Dial Intercom 0 anytime for room cleaning, extra towels, pillows, or front desk assistance.',
    },
  ];

  return `
    <div style="${BASE_STYLES}">
      <!-- Hotel Header Banner -->
      <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-bottom: 2px solid #f59e0b; padding: 24px; text-align: center;">
        <h2 style="color: #f59e0b; margin: 0; font-size: 22px; letter-spacing: 0.5px;">🏨 ${data.hotelName}</h2>
        <p style="color: #94a3b8; font-size: 13px; margin: 4px 0 0;">
          ${data.hotelAddress} ${data.hotelPhone ? `&bull; 📞 ${data.hotelPhone}` : ''}
        </p>
      </div>

      <div style="padding: 26px;">
        <!-- 🌟 VIP Guest Official Stay Poster 🌟 -->
        ${renderPosterBanner({
          badge: '🏨 OFFICIAL STAY CONFIRMATION',
          name: data.guestName,
          hotelName: data.hotelName,
          tagline: `Room #${data.roomNumbers} (${data.roomCategory}) &bull; Ref: ${data.bookingNumber}`,
          colorTheme: 'gold',
        })}

        <p style="color: #cbd5e1; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
          Dear <strong>${data.guestName}</strong>,<br/>
          Thank you for choosing <strong>${data.hotelName}</strong>. Your room reservation is confirmed! Below are your complete reservation details, room amenities, and important house instructions.
        </p>

        <!-- 1. Stay & Room Allocation Details Card -->
        <div style="background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
          <h3 style="color: #f59e0b; margin: 0 0 14px 0; font-size: 16px; display: flex; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 10px;">
            🛏️ Stay & Room Details
          </h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="color: #94a3b8; padding: 7px 0; width: 42%;">Booking Reference:</td>
              <td style="color: #38bdf8; padding: 7px 0; font-weight: bold; font-family: monospace; font-size: 15px;">${data.bookingNumber}</td>
            </tr>
            <tr>
              <td style="color: #94a3b8; padding: 7px 0;">Allocated Room(s):</td>
              <td style="color: #f8fafc; padding: 7px 0; font-weight: 800; font-size: 15px;">Room #${data.roomNumbers}</td>
            </tr>
            <tr>
              <td style="color: #94a3b8; padding: 7px 0;">Room Category & Bed:</td>
              <td style="color: #e2e8f0; padding: 7px 0; font-weight: 600;">${data.roomCategory} (${data.bedType || '1 King Bed'})</td>
            </tr>
            <tr>
              <td style="color: #94a3b8; padding: 7px 0;">Check-In Date & Time:</td>
              <td style="color: #34d399; padding: 7px 0; font-weight: bold;">${data.checkInDate} &bull; ${data.checkInTime}</td>
            </tr>
            <tr>
              <td style="color: #94a3b8; padding: 7px 0;">Check-Out Date & Time:</td>
              <td style="color: #f59e0b; padding: 7px 0; font-weight: bold;">${data.checkOutDate} &bull; 12:00 PM (Noon)</td>
            </tr>
            <tr>
              <td style="color: #94a3b8; padding: 7px 0;">Duration of Stay:</td>
              <td style="color: #f8fafc; padding: 7px 0; font-weight: bold;">${data.numberOfNights} Night(s)</td>
            </tr>
            <tr>
              <td style="color: #94a3b8; padding: 7px 0;">Total Guests:</td>
              <td style="color: #e2e8f0; padding: 7px 0;">${data.totalGuests} Guest(s) (${data.adults} Adults, ${data.children} Children)</td>
            </tr>
            ${
              data.accompanyingMembers && data.accompanyingMembers.length > 0
                ? `
              <tr>
                <td style="color: #94a3b8; padding: 7px 0;">Accompanying Members:</td>
                <td style="color: #cbd5e1; padding: 7px 0; font-size: 13px;">${data.accompanyingMembers.join(', ')}</td>
              </tr>
            `
                : ''
            }
          </table>
        </div>

        <!-- 2. Financial Settlement Summary -->
        <div style="background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
          <h3 style="color: #10b981; margin: 0 0 14px 0; font-size: 16px; border-bottom: 1px solid #334155; padding-bottom: 10px;">
            💳 Payment & Financial Summary
          </h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="color: #94a3b8; padding: 6px 0;">Total Tariff Amount:</td>
              <td style="color: #f8fafc; padding: 6px 0; text-align: right; font-weight: bold;">₹${data.totalAmount.toLocaleString('en-IN')}</td>
            </tr>
            <tr>
              <td style="color: #94a3b8; padding: 6px 0;">Amount Settled (${data.paymentMethod}):</td>
              <td style="color: #10b981; padding: 6px 0; text-align: right; font-weight: bold; font-size: 15px;">₹${data.paidAmount.toLocaleString('en-IN')}</td>
            </tr>
            ${
              data.securityDeposit && data.securityDeposit > 0
                ? `
              <tr>
                <td style="color: #94a3b8; padding: 6px 0;">Security Deposit (Refundable):</td>
                <td style="color: #38bdf8; padding: 6px 0; text-align: right; font-weight: 600;">₹${data.securityDeposit.toLocaleString('en-IN')}</td>
              </tr>
            `
                : ''
            }
            <tr style="border-top: 1px dashed #334155;">
              <td style="color: #f8fafc; padding: 10px 0 0 0; font-weight: bold;">Balance Due at Checkout:</td>
              <td style="color: ${data.dueAmount > 0 ? '#ef4444' : '#10b981'}; padding: 10px 0 0 0; text-align: right; font-weight: 900; font-size: 16px;">
                ${data.dueAmount > 0 ? `₹${data.dueAmount.toLocaleString('en-IN')}` : '✅ Fully Settled (₹0 Due)'}
              </td>
            </tr>
          </table>
        </div>

        <!-- 3. 🌟 Room Amenities & In-Room Privileges (રૂમ ની Amenities / સુવિધાઓ) -->
        <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 1.5px solid #38bdf8; border-radius: 12px; padding: 20px; margin-bottom: 20px; box-shadow: 0 4px 14px rgba(56, 189, 248, 0.1);">
          <h3 style="color: #38bdf8; margin: 0 0 10px 0; font-size: 16px; border-bottom: 1px solid #334155; padding-bottom: 10px;">
            ✨ Room Amenities & In-Room Privileges (રૂમ ની સુવિધાઓ)
          </h3>
          <p style="color: #94a3b8; font-size: 13px; margin: 0 0 14px 0;">
            Your allocated room is fully prepared with the following premium amenities:
          </p>

          <table style="width: 100%; border-collapse: collapse;">
            ${finalAmenities
              .map(
                (amenity) => `
              <tr>
                <td style="padding: 4px 0;">
                  <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid #334155; border-radius: 8px; padding: 10px 14px; color: #f8fafc; font-size: 13px; font-weight: 600;">
                    ${amenity.includes(' ') && !amenity.match(/^[\p{Emoji}]/u) ? `✓ ${amenity}` : amenity}
                  </div>
                </td>
              </tr>
            `
              )
              .join('')}
          </table>
        </div>

        <!-- 4. 📋 Important Room Instructions & Guidelines (રૂમ ના મહત્વપૂર્ણ સુચનાઓ / નિયમો) -->
        <div style="background: #1e293b; border: 1.5px solid #f59e0b; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
          <h3 style="color: #f59e0b; margin: 0 0 12px 0; font-size: 16px; border-bottom: 1px solid #334155; padding-bottom: 10px;">
            📋 Important Room Instructions & House Rules (રૂમ ના નિયમો અને સુચનાઓ)
          </h3>
          <p style="color: #94a3b8; font-size: 13px; margin: 0 0 14px 0;">
            To ensure your safety, comfort, and seamless stay experience, kindly observe the following guidelines:
          </p>

          <table style="width: 100%; border-collapse: collapse;">
            ${defaultInstructions
              .map(
                (inst) => `
              <tr>
                <td style="padding: 6px 0;">
                  <div style="background: rgba(15, 23, 42, 0.75); border: 1px solid #334155; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 12px 14px;">
                    <div style="color: #fbbf24; font-size: 14px; font-weight: bold; margin-bottom: 4px;">
                      ${inst.icon} ${inst.title}
                    </div>
                    <div style="color: #cbd5e1; font-size: 13px; line-height: 1.5;">
                      ${inst.desc}
                    </div>
                  </div>
                </td>
              </tr>
            `
              )
              .join('')}
          </table>
        </div>

        <!-- Quick Assistance Intercom Box -->
        <div style="background: linear-gradient(135deg, #065f46 0%, #047857 100%); border-radius: 10px; padding: 16px 20px; text-align: center; margin-bottom: 20px;">
          <h4 style="color: #ffffff; margin: 0 0 6px 0; font-size: 15px;">🛎️ Need Anything During Your Stay?</h4>
          <p style="color: #a7f3d0; margin: 0; font-size: 13px; font-weight: 600;">
            Dial <strong>0</strong> from your room intercom for 24/7 Front Desk, or Dial <strong>9</strong> for In-Room Dining & Room Service.
          </p>
        </div>

        <p style="color: #94a3b8; font-size: 13px; text-align: center; margin: 20px 0 0 0;">
          We wish you a wonderful and relaxing stay at <strong>${data.hotelName}</strong>!
        </p>
      </div>

      <!-- Footer -->
      <div style="background: #090d16; padding: 18px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #1e293b;">
        © 2026 ${data.hotelName} &bull; Powered by Hotel Management Cloud<br/>
        Address: ${data.hotelAddress} &bull; Inquiries: ${data.hotelEmail || 'support@hotelmgmt.com'}
      </div>
    </div>
  `;
};