// 🏨 Multi-Tenant Hotel Management System Professional Email Templates

const BASE_STYLES = `
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  max-width: 600px;
  margin: 0 auto;
  background: #0f172a;
  color: #f8fafc;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #334155;
`;

// 1. Hotel Registration Received (Pending Approval)
export const hotelRegistrationReceivedTemplate = (hotelName: string, ownerName: string): string => {
  return `
    <div style="${BASE_STYLES}">
      <div style="background: linear-gradient(135deg, #1e293b, #0f172a); border-bottom: 2px solid #f59e0b; padding: 30px; text-align: center;">
        <h1 style="color: #f59e0b; margin: 0; font-size: 24px;">🏨 Hotel Registration Received</h1>
        <p style="color: #94a3b8; margin: 6px 0 0;">The Grand Royale SaaS Platform</p>
      </div>
      <div style="padding: 30px;">
        <h3 style="color: #f8fafc; margin-top: 0;">Hello ${ownerName},</h3>
        <p style="color: #cbd5e1; font-size: 15px; line-height: 1.6;">
          Thank you for registering <strong>${hotelName}</strong> on our Multi-Tenant Hotel Management Platform.
        </p>
        <div style="background: #1e293b; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0; color: #94a3b8; font-size: 14px;">
            ⏳ <strong>Status:</strong> PENDING APPROVAL<br/>
            Our Super Admin team is reviewing your hotel business details and documents. You will receive an email immediately upon verification.
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
  return `
    <div style="${BASE_STYLES}">
      <div style="background: linear-gradient(135deg, #065f46, #047857); padding: 30px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px;">🎉 Hotel Registration Approved!</h1>
        <p style="color: #a7f3d0; margin: 6px 0 0; font-weight: 600;">Welcome to The Grand Royale SaaS Platform</p>
      </div>
      <div style="padding: 30px;">
        <h3 style="color: #f8fafc; margin-top: 0;">Congratulations ${data.ownerName},</h3>
        <p style="color: #cbd5e1; font-size: 15px; line-height: 1.6;">
          Your hotel <strong>${data.hotelName}</strong> has been successfully approved! Your <strong>30-Day FREE TRIAL</strong> has started today.
        </p>

        <!-- Credentials Box -->
        <div style="background: #1e293b; border: 1px solid #334155; padding: 20px; margin: 20px 0; border-radius: 8px;">
          <h4 style="color: #f59e0b; margin-top: 0;">🔑 Your Hotel Admin Credentials</h4>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="color: #94a3b8; padding: 6px 0; font-size: 14px;">Portal URL:</td>
              <td style="color: #38bdf8; padding: 6px 0; font-weight: bold;"><a href="${data.loginUrl}" style="color: #38bdf8;">${data.loginUrl}</a></td>
            </tr>
            <tr>
              <td style="color: #94a3b8; padding: 6px 0; font-size: 14px;">Login Email:</td>
              <td style="color: #f8fafc; padding: 6px 0; font-weight: bold;">${data.adminEmail}</td>
            </tr>
            <tr>
              <td style="color: #94a3b8; padding: 6px 0; font-size: 14px;">Temporary Password:</td>
              <td style="color: #34d399; padding: 6px 0; font-family: monospace; font-size: 16px; font-weight: bold;">${data.temporaryPassword}</td>
            </tr>
            <tr>
              <td style="color: #94a3b8; padding: 6px 0; font-size: 14px;">Free Trial Active:</td>
              <td style="color: #fbbf24; padding: 6px 0;">${data.trialStartDate} to ${data.trialEndDate}</td>
            </tr>
          </table>
        </div>

        <div style="background: rgba(239, 68, 68, 0.1); border-left: 4px solid #ef4444; padding: 12px; margin-bottom: 25px; border-radius: 4px;">
          <p style="margin: 0; color: #fca5a5; font-size: 13px;">
            ⚠️ <strong>Security Notice:</strong> You will be prompted to change your temporary password upon your first login.
          </p>
        </div>

        <div style="text-align: center;">
          <a href="${data.loginUrl}" style="background: #f59e0b; color: #0f172a; font-weight: bold; text-decoration: none; padding: 14px 35px; border-radius: 6px; display: inline-block;">Login to Hotel Admin</a>
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
        <p style="color: #cbd5e1;">Dear ${ownerName},</p>
        <p style="color: #cbd5e1;">We regret to inform you that your registration for <strong>${hotelName}</strong> could not be approved at this time.</p>
        <div style="background: #1e293b; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; border-radius: 4px;">
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
      <div style="background: #1e293b; border-bottom: 3px solid ${badgeColor}; padding: 30px; text-align: center;">
        <h2 style="color: ${badgeColor}; margin: 0; font-size: 22px;">⚠️ ${title}</h2>
        <p style="color: #94a3b8; margin: 6px 0 0;">${data.hotelName}</p>
      </div>
      <div style="padding: 30px;">
        <p style="color: #cbd5e1; font-size: 15px;">Dear <strong>${data.ownerName}</strong>,</p>
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
  return `
    <div style="${BASE_STYLES}">
      <div style="background: linear-gradient(135deg, #065f46, #047857); padding: 25px; text-align: center;">
        <h2 style="color: #ffffff; margin: 0;">✅ Hotel Account Re-Activated</h2>
      </div>
      <div style="padding: 25px;">
        <p style="color: #cbd5e1;">Dear <strong>${ownerName}</strong>,</p>
        <p style="color: #cbd5e1;">We are pleased to inform you that your hotel <strong>${hotelName}</strong> has been re-activated by Super Administrator.</p>
        <p style="color: #34d399; font-weight: bold;">All hotel admin features and front desk operations have been restored to active status.</p>
        <div style="text-align: center; margin-top: 25px;">
          <a href="http://localhost:3001/login" style="background: #10b981; color: #0f172a; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: bold; display: inline-block;">Access Dashboard</a>
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
  return `
    <div style="${BASE_STYLES}">
      <div style="background: #1e293b; border-bottom: 2px solid #3b82f6; padding: 25px; text-align: center;">
        <h2 style="color: #38bdf8; margin: 0;">🛎️ Front Desk Receptionist Account Created</h2>
        <p style="color: #94a3b8; margin: 5px 0 0;">${data.hotelName}</p>
      </div>
      <div style="padding: 25px;">
        <p style="color: #cbd5e1;">Hello <strong>${data.receptionistName}</strong>,</p>
        <p style="color: #94a3b8;">You have been assigned as a Front Desk Receptionist at <strong>${data.hotelName}</strong>. Below are your login credentials:</p>
        
        <div style="background: #1e293b; border: 1px solid #334155; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 6px 0; color: #94a3b8;">Employee ID: <strong style="color: #f8fafc;">${data.employeeId || 'N/A'}</strong></p>
          <p style="margin: 6px 0; color: #94a3b8;">Login Email: <strong style="color: #f8fafc;">${data.email}</strong></p>
          <p style="margin: 6px 0; color: #94a3b8;">Temporary Password: <strong style="color: #34d399; font-family: monospace;">${data.temporaryPassword}</strong></p>
        </div>

        <div style="text-align: center; margin-top: 25px;">
          <a href="${data.loginUrl}" style="background: #3b82f6; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: bold; display: inline-block;">Login to Front Desk</a>
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
        <p style="color: #cbd5e1; font-size: 15px;">Hello ${userName}, use the OTP code below to reset your password:</p>
        <div style="background: #1e293b; display: inline-block; padding: 15px 35px; border-radius: 8px; border: 1px dashed #f59e0b; margin: 20px auto;">
          <span style="font-size: 32px; font-family: monospace; letter-spacing: 6px; font-weight: bold; color: #f59e0b;">${otp}</span>
        </div>
        <p style="color: #94a3b8; font-size: 13px;">This OTP is valid for 15 minutes. If you did not request this, please ignore this email.</p>
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