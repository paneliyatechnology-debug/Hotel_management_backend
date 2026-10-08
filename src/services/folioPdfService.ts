import fs from 'fs';
import path from 'path';
import puppeteer, { Browser } from 'puppeteer';

export interface GenerateFolioPdfParams {
  guest: any;
  activeBooking: any;
  roomsDetail?: any[];
  paymentDetails?: any;
  paymentHistory?: any[];
  charges?: any[];
  accompanyingGuests?: any[];
  hotel?: any;
  req?: any;
  baseUrl?: string;
}

// Reusable Puppeteer Browser Instance
let cachedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (cachedBrowser && cachedBrowser.connected) {
    return cachedBrowser;
  }

  cachedBrowser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=medium',
    ],
  });

  cachedBrowser.on('disconnected', () => {
    cachedBrowser = null;
  });

  return cachedBrowser;
}

// Read and cache the HTML template
let cachedTemplate: string | null = null;
function getFolioTemplate(): string {
  if (cachedTemplate && process.env.NODE_ENV === 'production') {
    return cachedTemplate;
  }
  const possiblePaths = [
    path.join(__dirname, '../templates/guestFolioTemplate.html'),
    path.join(process.cwd(), 'src/templates/guestFolioTemplate.html'),
    path.join(process.cwd(), 'dist/templates/guestFolioTemplate.html'),
  ];

  for (const tPath of possiblePaths) {
    if (fs.existsSync(tPath)) {
      cachedTemplate = fs.readFileSync(tPath, 'utf8');
      return cachedTemplate;
    }
  }

  throw new Error('guestFolioTemplate.html not found in templates directory');
}

// Read default logo from local disk as base64 data URI
let cachedDefaultLogoBase64: string | null = null;
function getDefaultLogoBase64(): string {
  if (cachedDefaultLogoBase64) return cachedDefaultLogoBase64;
  try {
    const logoPath = path.join(process.cwd(), 'public', 'logo.png');
    if (fs.existsSync(logoPath)) {
      const data = fs.readFileSync(logoPath);
      cachedDefaultLogoBase64 = `data:image/png;base64,${data.toString('base64')}`;
      return cachedDefaultLogoBase64;
    }
  } catch (err) {
    console.warn('Could not read default public/logo.png:', err);
  }
  return '';
}

function cleanImageSrc(src?: string): string {
  if (!src) return '';
  if (src.startsWith('<svg') || src.startsWith('data:image/svg+xml;utf8,<svg')) {
    const rawSvg = src.startsWith('data:image/svg+xml;utf8,') ? src.replace('data:image/svg+xml;utf8,', '') : src;
    return `data:image/svg+xml;base64,${Buffer.from(rawSvg).toString('base64')}`;
  }
  return src;
}

function formatTime12Hour(timeStr?: string): string {
  if (!timeStr) return '12:00 PM';
  if (/AM|PM/i.test(timeStr)) return timeStr;
  const parts = timeStr.split(':');
  if (parts.length >= 2) {
    let h = parseInt(parts[0], 10);
    const m = parts[1].padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
  }
  return timeStr;
}

/**
 * Builds the complete HTML by loading the static template and replacing ONLY dynamic fields
 */
export function buildFolioHtml(params: GenerateFolioPdfParams): string {
  const guest = params.guest || {};
  const booking = params.activeBooking || guest.activeBooking || {};
  const paymentHistory = params.paymentHistory || booking.paymentHistory || booking.payments || [];
  const roomsDetail = params.roomsDetail || [];
  const charges = params.charges || booking.charges || booking.posCharges || [];
  const accompanying = params.accompanyingGuests || booking.accompanyingGuests || guest.accompanyingGuests || [];
  const hotel = params.hotel || {};

  const hotelName = hotel.name || 'MYOWNPMS Luxury Hotel';
  const hotelAddress = hotel.address || hotel.city || 'Marine Drive, Mumbai, Maharashtra';
  const hotelPhone = hotel.phone || hotel.ownerPhone || '+91 98200 12345';
  const hotelGst = hotel.gstNumber || hotel.gstin || hotel.settings?.gstin || '27AABCG1234F1Z8';
  const bookingNumber = booking.bookingNumber || `BK-${Date.now().toString().slice(-6)}`;

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase();
  const folioDateTime = `${dateStr} &bull; ${timeStr}`;

  // Logo source
  let logoSrc = hotel.logo || getDefaultLogoBase64();
  if (!logoSrc) {
    logoSrc = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="%230F766E"><path d="M19 2H5c-1.1 0-2 .9-2 2v17h2v-7h4v7h2v-7h4v7h2v-7h2v7h2V4c0-1.1-.9-2-2-2zm-7 10H7v-2h5v2zm0-4H7V6h5v2zm5 4h-3v-2h3v2zm0-4h-3V6h3v2z"/></svg>';
  }

  // Dates & Times
  const checkInDateFormatted = booking.checkInDate
    ? (typeof booking.checkInDate === 'string' ? booking.checkInDate.split('T')[0] : new Date(booking.checkInDate).toISOString().split('T')[0])
    : 'On Record';
  const checkInTimeFormatted = formatTime12Hour(booking.checkInTime || '14:00');
  const checkOutDateFormatted = booking.checkOutDate
    ? (typeof booking.checkOutDate === 'string' ? booking.checkOutDate.split('T')[0] : new Date(booking.checkOutDate).toISOString().split('T')[0])
    : 'Scheduled';
  const checkOutTimeFormatted = formatTime12Hour(booking.checkOutTime || hotel.settings?.checkOutTime || '12:00');

  const nights = Number(booking.numberOfNights) || Number(booking.nights) || 1;
  const nightsLabel = `${nights} Night${nights > 1 ? 's' : ''}`;

  const lateFee = Number(booking.lateCheckoutCharge) || 0;
  const lateHours = Number(booking.lateCheckoutHours) || 0;
  const hourlyRate = Number(booking.hourlyRate) || (lateHours > 0 ? Math.round(lateFee / lateHours) : 0);
  const isLate = lateFee > 0;

  let lateCheckoutBanner = '';
  if (isLate) {
    lateCheckoutBanner = `
      <div style="margin-top:5px; background:#FEF2F2; border:1px solid #FCA5A5; border-radius:6px; padding:3px 7px; font-size:10px; color:#DC2626; font-weight:800;">
        ⚠️ Late Check-Out: ${lateHours}h overstay @ ₹${hourlyRate}/hr (+₹${lateFee.toLocaleString('en-IN')})
      </div>
    `;
  }

  const posTotal = charges.reduce((s: number, c: any) => s + (Number(c.amount) || Number(c.totalAmount) || 0), 0);
  const roomBreakdowns = Array.isArray(booking.roomGstBreakdown) && booking.roomGstBreakdown.length > 0 ? booking.roomGstBreakdown : [];

  const rawBookingTotal = Number(booking.totalAmount) || Number(booking.grandTotal) || (booking.paidAmount ? Number(booking.paidAmount) : 3000);
  const originalBookingTotal = isLate && rawBookingTotal > lateFee ? rawBookingTotal - lateFee : rawBookingTotal;

  let defaultGstRate = Number(booking.gstRate) || Number(hotel.settings?.defaultGstRate) || 18;
  let taxableVal = Number(booking.taxableAmount) || Number(booking.baseAmount) || 0;
  let totalGst = Number(booking.gstAmount) || Number(booking.taxAmount) || 0;

  if (roomBreakdowns.length > 0) {
    taxableVal = roomBreakdowns.reduce((s: number, r: any) => s + (Number(r.taxableAmount) || 0), 0);
    totalGst = roomBreakdowns.reduce((s: number, r: any) => s + (Number(r.gstAmount) || 0), 0);
  }

  if (!taxableVal) {
    if (booking.taxInclusive) {
      taxableVal = Math.round(originalBookingTotal / (1 + defaultGstRate / 100));
    } else {
      taxableVal = originalBookingTotal;
    }
  }

  if (!totalGst) {
    totalGst = Math.round((taxableVal * defaultGstRate) / 100);
  }

  const cgstVal = Number(booking.cgstAmount) || Math.round(totalGst / 2);
  const sgstVal = Number(booking.sgstAmount) || Math.max(0, totalGst - cgstVal);
  const baseRatePerNight = Math.round(taxableVal / nights) || Number(booking.pricePerNight) || Math.round(originalBookingTotal / nights);

  const grandTotalAmount = Number(booking.grandTotal) || Number(booking.totalAmount) || (taxableVal + totalGst + lateFee + posTotal);
  const paidAmount = Number(booking.paidAmount) !== undefined && Number(booking.paidAmount) !== null && !isNaN(Number(booking.paidAmount))
    ? Number(booking.paidAmount)
    : (paymentHistory.length > 0 ? paymentHistory.reduce((s: number, p: any) => s + (Number(p.amount) || Number(p.total) || 0), 0) : grandTotalAmount);

  const dueAmount = Number(booking.dueAmount) !== undefined && !isNaN(Number(booking.dueAmount))
    ? Number(booking.dueAmount)
    : Math.max(0, grandTotalAmount - paidAmount);

  const guestName = guest.fullName || guest.name || booking.guestName || 'Valued Guest';
  const guestPhone = guest.mobileNumber || guest.phone || booking.guestPhone || 'On Record';
  const guestEmail = guest.email || booking.guestEmail || 'Not Provided';
  const guestAddress = guest.address?.city || guest.city || guest.address?.fullAddress || guest.address || 'Verified On Record';
  const govtIdType = guest.idProof?.idType || guest.govtIdType || guest.idType || 'AADHAAR';
  const govtIdNumber = guest.idProof?.idNumber || guest.govtIdNumber || guest.idNumber || 'Verified On Record';
  const roomNumberDisplay = booking.roomNumber || booking.room?.roomNumber || (Array.isArray(booking.rooms) && booking.rooms[0]?.roomNumber) || guest.roomAssigned || '101';
  const roomTypeNameDisplay = (typeof booking.roomType === 'object' && booking.roomType?.name) ? booking.roomType.name : (booking.roomTypeName || 'Executive Suite');
  const guestStatus = guest.status || booking.status || 'IN-HOUSE';

  // 1. Accompanying Members Table (if any)
  let accompanyingMembersSection = '';
  if (accompanying && accompanying.length > 0) {
    accompanyingMembersSection = `
      <div class="pdf-section" style="margin-bottom: 12px;">
        <div style="font-size: 10.5px; font-weight: 900; color: #0F172A; text-transform: uppercase; margin-bottom: 5px; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">
          <span>👥</span> ACCOMPANYING FAMILY MEMBERS &amp; CO-GUESTS (${accompanying.length})
        </div>
        <table style="width: 100%; border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background: #0F766E; color: #FFFFFF;">
              <th style="padding: 6px 7px; text-align: center; width: 28px;">#</th>
              <th style="padding: 6px 7px; text-align: left;">Member Full Name</th>
              <th style="padding: 6px 7px; text-align: left;">Age / Gender</th>
              <th style="padding: 6px 7px; text-align: left;">Relationship</th>
              <th style="padding: 6px 7px; text-align: left;">Govt ID Type</th>
              <th style="padding: 6px 7px; text-align: left;">ID Proof Number</th>
              <th style="padding: 6px 7px; text-align: center; width: 80px;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${accompanying.map((m: any, idx: number) => `
              <tr style="border-bottom: 1px solid #E2E8F0; background: ${idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC'};">
                <td style="padding: 6px 7px; text-align: center; font-weight: 700; color: #64748B;">${idx + 1}</td>
                <td style="padding: 6px 7px; font-weight: 800; color: #0F172A;">${m.name || m.fullName || `Member ${idx + 1}`}</td>
                <td style="padding: 6px 7px; color: #475569;">${m.age ? `${m.age} yrs` : '-'} / ${m.gender || '-'}</td>
                <td style="padding: 6px 7px; color: #6D28D9; font-weight: 700;">${m.relationship || 'Accompanying Guest'}</td>
                <td style="padding: 6px 7px; font-weight: 700; color: #334155;">${m.idType || 'AADHAAR'}</td>
                <td style="padding: 6px 7px; font-family: monospace;">${m.idNumber || 'Verified On Record'}</td>
                <td style="padding: 6px 7px; text-align: center; color: #15803D; font-weight: 800;">✓ Verified</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // 2. Room Tariff Table Rows
  let roomTariffRows = '';
  if (roomsDetail && roomsDetail.length > 0) {
    roomTariffRows = roomsDetail.map((rm: any, idx: number) => {
      const rmNights = Number(rm.numberOfNights) || nights || 1;
      const rmGstRate = Number(rm.gstRate) || defaultGstRate;
      const rmPrice = Number(rm.pricePerNight) || Number(rm.basePrice) || baseRatePerNight;
      const rmTaxable = Number(rm.taxableAmount) || (rmPrice * rmNights);
      const rmGst = Number(rm.gstAmount) !== undefined && !isNaN(Number(rm.gstAmount)) && Number(rm.gstAmount) > 0 ? Number(rm.gstAmount) : Math.round((rmTaxable * rmGstRate) / 100);
      const rmTotal = Number(rm.roomTotal) || Number(rm.finalAmount) || (rmTaxable + rmGst);
      const rmCgst = Math.round(rmGst / 2);
      const rmSgst = rmGst - rmCgst;
      return `
        <tr style="border-bottom: 1px solid #E2E8F0; background: #FFFFFF;">
          <td style="padding: 7px 6px; text-align: center; font-weight: 700; color: #64748B;">${idx + 1}</td>
          <td style="padding: 7px 8px;">
            <div style="font-weight: 900; color: #0F172A;">Room #${rm.roomNumber} &bull; ${rm.roomType || roomTypeNameDisplay}</div>
            <div style="font-size: 9px; color: #64748B; margin-top: 1px;">CGST @ ${rmGstRate / 2}% (₹${rmCgst.toLocaleString('en-IN')}) + SGST @ ${rmGstRate / 2}% (₹${rmSgst.toLocaleString('en-IN')})</div>
          </td>
          <td style="padding: 7px 6px; text-align: center; font-family: monospace; color: #475569;">996311</td>
          <td style="padding: 7px 6px; text-align: center; font-weight: 700; color: #0F172A;">${rmNights} Night${rmNights > 1 ? 's' : ''}</td>
          <td style="padding: 7px 8px; text-align: right; color: #334155;">₹${rmPrice.toLocaleString('en-IN')}</td>
          <td style="padding: 7px 8px; text-align: right; font-weight: 700; color: #0F172A;">₹${rmTaxable.toLocaleString('en-IN')}</td>
          <td style="padding: 7px 6px; text-align: center; color: #0F766E; font-weight: 800;">${rmGstRate}%</td>
          <td style="padding: 7px 8px; text-align: right; color: #475569;">₹${rmGst.toLocaleString('en-IN')}</td>
          <td style="padding: 7px 8px; text-align: right; font-weight: 900; color: #059669;">₹${rmTotal.toLocaleString('en-IN')}</td>
        </tr>
      `;
    }).join('');
  } else {
    roomTariffRows = `
      <tr style="border-bottom: 1px solid #E2E8F0; background: #FFFFFF;">
        <td style="padding: 7px 6px; text-align: center; font-weight: 700; color: #64748B;">1</td>
        <td style="padding: 7px 8px;">
          <div style="font-weight: 900; color: #0F172A;">Room #${roomNumberDisplay} &bull; ${roomTypeNameDisplay}</div>
          <div style="font-size: 9px; color: #64748B; margin-top: 1px;">CGST @ ${defaultGstRate / 2}% (₹${cgstVal.toLocaleString('en-IN')}) + SGST @ ${defaultGstRate / 2}% (₹${sgstVal.toLocaleString('en-IN')})</div>
        </td>
        <td style="padding: 7px 6px; text-align: center; font-family: monospace; color: #475569;">996311</td>
        <td style="padding: 7px 6px; text-align: center; font-weight: 700; color: #0F172A;">${nights} Night${nights > 1 ? 's' : ''}</td>
        <td style="padding: 7px 8px; text-align: right; color: #334155;">₹${baseRatePerNight.toLocaleString('en-IN')}</td>
        <td style="padding: 7px 8px; text-align: right; font-weight: 700; color: #0F172A;">₹${taxableVal.toLocaleString('en-IN')}</td>
        <td style="padding: 7px 6px; text-align: center; color: #0F766E; font-weight: 800;">${defaultGstRate}%</td>
        <td style="padding: 7px 8px; text-align: right; color: #475569;">₹${totalGst.toLocaleString('en-IN')}</td>
        <td style="padding: 7px 8px; text-align: right; font-weight: 900; color: #059669;">₹${(taxableVal + totalGst).toLocaleString('en-IN')}</td>
      </tr>
    `;
  }

  // Late checkout surcharge row (if late)
  if (isLate) {
    roomTariffRows += `
      <tr style="border-bottom: 1px solid #E2E8F0; background: #FFF5F5;">
        <td style="padding: 7px 6px; text-align: center; font-weight: 700; color: #DC2626;">${(roomsDetail.length || 1) + 1}</td>
        <td style="padding: 7px 8px;">
          <div style="font-weight: 900; color: #DC2626;">Late Check-Out Surcharge</div>
          <div style="font-size: 9px; color: #991B1B;">Overstayed ${lateHours}h @ ₹${hourlyRate}/hr</div>
        </td>
        <td style="padding: 7px 6px; text-align: center; font-family: monospace; color: #475569;">996311</td>
        <td style="padding: 7px 6px; text-align: center; font-weight: 700;">${lateHours}h</td>
        <td style="padding: 7px 8px; text-align: right;">₹${hourlyRate.toLocaleString('en-IN')}</td>
        <td style="padding: 7px 8px; text-align: right; font-weight: 700;">₹${lateFee.toLocaleString('en-IN')}</td>
        <td style="padding: 7px 6px; text-align: center; color: #64748B;">0%</td>
        <td style="padding: 7px 8px; text-align: right;">₹0</td>
        <td style="padding: 7px 8px; text-align: right; font-weight: 900; color: #DC2626;">₹${lateFee.toLocaleString('en-IN')}</td>
      </tr>
    `;
  }

  // Extra charges rows
  if (charges.length > 0) {
    charges.forEach((c: any, i: number) => {
      const cAmt = Number(c.amount) || Number(c.totalAmount) || 0;
      roomTariffRows += `
        <tr style="border-bottom: 1px solid #E2E8F0; background: ${i % 2 === 0 ? '#F8FAFC' : '#FFFFFF'};">
          <td style="padding: 7px 6px; text-align: center; font-weight: 700; color: #64748B;">${(isLate ? 2 : 1) + 1 + i}</td>
          <td style="padding: 7px 8px;">
            <div style="font-weight: 800; color: #0F172A;">${c.title || c.item || c.serviceName || 'POS Room Service'}</div>
            <div style="font-size: 9px; color: #64748B;">Category: <strong>${c.category || 'F&B / Sundry'}</strong></div>
          </td>
          <td style="padding: 7px 6px; text-align: center; font-family: monospace; color: #475569;">996331</td>
          <td style="padding: 7px 6px; text-align: center; font-weight: 700;">${c.quantity || 1}</td>
          <td style="padding: 7px 8px; text-align: right;">₹${cAmt.toLocaleString('en-IN')}</td>
          <td style="padding: 7px 8px; text-align: right; font-weight: 700;">₹${cAmt.toLocaleString('en-IN')}</td>
          <td style="padding: 7px 6px; text-align: center; color: #64748B;">0%</td>
          <td style="padding: 7px 8px; text-align: right;">₹0</td>
          <td style="padding: 7px 8px; text-align: right; font-weight: 900; color: #0F172A;">₹${cAmt.toLocaleString('en-IN')}</td>
        </tr>
      `;
    });
  }

  // 3. Payment Ledger Rows
  let paymentLedgerRows = '';
  if (paymentHistory.length > 0) {
    paymentLedgerRows = paymentHistory.map((p: any, idx: number) => {
      const pAmt = Number(p.amount) || Number(p.total) || 0;
      const pMethod = (p.paymentMethod || 'UPI').toUpperCase();
      const pDate = p.formattedDate || (p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : dateStr);
      return `
        <tr style="border-bottom: 1px solid #E2E8F0; background: ${idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC'};">
          <td style="padding: 6.5px 7px; text-align: center; font-weight: 700; color: #64748B;">${idx + 1}</td>
          <td style="padding: 6.5px 8px; font-weight: 800; color: #0F766E; font-family: monospace;">#${p.receiptNumber || p.transactionId || 'RCP-001'}</td>
          <td style="padding: 6.5px 8px; color: #475569;">${pDate}</td>
          <td style="padding: 6.5px 8px; font-weight: 600; color: #334155;">${p.paymentType || 'Settlement'}</td>
          <td style="padding: 6.5px 8px; color: #0F766E; font-weight: 800;">${pMethod}</td>
          <td style="padding: 6.5px 8px; text-align: right; font-weight: 900; color: #059669;">₹${pAmt.toLocaleString('en-IN')}</td>
          <td style="padding: 6.5px 8px; text-align: center; color: #15803D; font-weight: 900;">✓ PAID</td>
        </tr>
      `;
    }).join('');
  } else {
    paymentLedgerRows = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 10px; color: #64748B;">No transaction records logged yet.</td>
      </tr>
    `;
  }

  // 4. Financial Summary Extra Rows
  let extraPosRow = '';
  if (posTotal > 0) {
    extraPosRow = `
      <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 10px; color: #0F766E; font-weight: 700;">
        <span>Extra POS / F&amp;B (${charges.length} items):</span>
        <span style="font-weight: 800;">+₹${posTotal.toLocaleString('en-IN')}</span>
      </div>
    `;
  }

  let lateCheckoutRow = '';
  if (isLate) {
    lateCheckoutRow = `
      <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 10px; color: #DC2626; font-weight: 700;">
        <span>Late Checkout Fee (${lateHours}h):</span>
        <span style="font-weight: 800;">+₹${lateFee.toLocaleString('en-IN')}</span>
      </div>
    `;
  }

  // 5. ID Cards for Page 2
  const primaryFront = cleanImageSrc(guest.idProof?.frontImage || guest.idProof?.frontImageUrl || guest.frontImage || guest.frontImageUrl || booking.idProof?.frontImage || '');
  const primaryBack = cleanImageSrc(guest.idProof?.backImage || guest.idProof?.backImageUrl || guest.backImage || guest.backImageUrl || booking.idProof?.backImage || '');

  const allIdCards = [
    {
      name: guestName,
      tag: 'Primary Guest',
      tagColor: '#0F766E',
      tagBg: '#CCFBF1',
      idType: govtIdType,
      idNumber: govtIdNumber,
      frontImg: primaryFront,
      backImg: primaryBack,
    },
    ...accompanying.map((m: any, idx: number) => ({
      name: m.name || m.fullName || `Co-Guest ${idx + 1}`,
      tag: m.relationship || 'Accompanying Guest',
      tagColor: '#6D28D9',
      tagBg: '#EDE9FE',
      idType: m.idType || 'AADHAAR',
      idNumber: m.idNumber || 'Verified On Record',
      frontImg: cleanImageSrc(m.frontImage || m.frontImageUrl || m.idProofImage || m.idProof?.frontImage || ''),
      backImg: cleanImageSrc(m.backImage || m.backImageUrl || m.idProofBackImage || m.idProof?.backImage || ''),
    })),
  ].filter((c) => Boolean(c.frontImg || c.backImg));

  let idProofsSection = '';
  if (allIdCards.length > 0) {
    idProofsSection = `
      <!-- Page 2 Header -->
      <div class="pdf-section" style="background: linear-gradient(135deg, #092622 0%, #0F766E 50%, #14B8A6 100%); border-radius: 12px; padding: 11px 16px; color: #FFFFFF; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 14px rgba(15, 118, 110, 0.2);">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="font-size: 20px;">🪪</div>
          <div>
            <div style="font-size: 14px; font-weight: 900; color: #FFFFFF; letter-spacing: -0.3px;">GOVT ID &amp; AADHAAR CARD PROOFS</div>
            <div style="font-size: 10px; color: rgba(255, 255, 255, 0.9); margin-top: 1px;">
              Folio #${bookingNumber} &bull; Primary Guest: <strong>${guestName}</strong>
            </div>
          </div>
        </div>
        <div style="text-align: right; padding: 2px 6px;">
          <div style="font-size: 10px; font-weight: 900; color: #FFFFFF; text-transform: uppercase; letter-spacing: 0.5px;">PAGE 2 OF 2</div>
          <div style="font-size: 8.5px; color: #99F6E4; margin-top: 1px;">ID Proof Attachments</div>
        </div>
      </div>

      <!-- Verified Status Banner -->
      <div class="pdf-section" style="padding: 5px 10px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px;">
        <div style="display: flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 800; color: #15803D;">
          <span>🛡️</span>
          <span>Digitally captured government identification records archived for official regulatory compliance.</span>
        </div>
        <span style="color: #15803D; font-size: 9px; font-weight: 900;">
          ✓ VERIFIED ATTACHMENTS
        </span>
      </div>

      <!-- ID Cards Grid -->
      <div style="display: grid; grid-template-columns: repeat(${allIdCards.length === 1 ? 1 : 2}, 1fr); gap: 12px; margin-bottom: 14px;">
        ${allIdCards.map((card: any) => `
          <div class="pdf-section" style="background: #F8FAFC; border: 1.5px solid #CBD5E1; border-radius: 12px; padding: 10px; box-sizing: border-box;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; border-bottom: 1.5px solid #E2E8F0; padding-bottom: 5px;">
              <div style="font-size: 11.5px; font-weight: 900; color: #0F172A; display: flex; align-items: center; gap: 6px;">
                <span>👤 ${card.name}</span>
                <span style="font-size: 8.5px; font-weight: 800; color: ${card.tagColor}; background: ${card.tagBg}; padding: 1px 5px; border-radius: 4px;">${card.tag}</span>
              </div>
              <div style="font-size: 10px; font-weight: 800; color: #0F766E; font-family: monospace;">
                ${card.idType}: ${card.idNumber}
              </div>
            </div>

            <div style="display: grid; grid-template-columns: ${card.frontImg && card.backImg ? '1fr 1fr' : '1fr'}; gap: 8px;">
              ${card.frontImg ? `
                <div style="border: 1px solid #CBD5E1; border-radius: 8px; overflow: hidden; background: #FFFFFF; padding: 5px;">
                  <div style="font-size: 8.5px; font-weight: 800; color: #64748B; margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.4px;">
                    📄 Front Side Photo
                  </div>
                  <div style="height: 160px; display: flex; align-items: center; justify-content: center; background: #F8FAFC; border-radius: 6px; overflow: hidden; border: 1px solid #E2E8F0;">
                    <img src="${card.frontImg}" alt="Front ID Photo" style="width: 100%; height: 100%; object-fit: contain;" />
                  </div>
                </div>
              ` : ''}

              ${card.backImg ? `
                <div style="border: 1px solid #CBD5E1; border-radius: 8px; overflow: hidden; background: #FFFFFF; padding: 5px;">
                  <div style="font-size: 8.5px; font-weight: 800; color: #64748B; margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.4px;">
                    📄 Back Side Photo
                  </div>
                  <div style="height: 160px; display: flex; align-items: center; justify-content: center; background: #F8FAFC; border-radius: 6px; overflow: hidden; border: 1px solid #E2E8F0;">
                    <img src="${card.backImg}" alt="Back ID Photo" style="width: 100%; height: 100%; object-fit: contain;" />
                  </div>
                </div>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Page 2 Official Verification Footer -->
      <div class="pdf-section" style="display: flex; justify-content: space-between; align-items: flex-end; padding-top: 8px; border-top: 1.5px solid #E2E8F0; font-size: 9.5px; color: #64748B;">
        <div>
          <div style="font-weight: 800; color: #0F172A; font-size: 10.5px;">${hotelName} &bull; Security &amp; Compliance Wing</div>
          <div style="font-size: 8.5px; color: #94A3B8; margin-top: 1px;">Archived Identity Documents attached to Stay Folio #${bookingNumber}</div>
        </div>
        <div style="text-align: right; width: 160px;">
          <div style="border-bottom: 1.5px dashed #94A3B8; margin-bottom: 3px; height: 22px;"></div>
          <div style="font-size: 9px; font-weight: 800; color: #0F172A; text-transform: uppercase;">Front Desk Verified</div>
        </div>
      </div>
    `;
  }

  // Replace placeholders in the static HTML template
  const template = getFolioTemplate();
  const replacements: Record<string, string> = {
    HOTEL_NAME: hotelName,
    HOTEL_ADDRESS: hotelAddress,
    HOTEL_PHONE: hotelPhone,
    HOTEL_GSTIN: hotelGst,
    HOTEL_LOGO_SRC: logoSrc,
    BOOKING_NUMBER: bookingNumber,
    FOLIO_DATE_TIME: folioDateTime,
    GUEST_NAME: guestName,
    GUEST_NAME_UPPER: guestName.toUpperCase(),
    GUEST_PHONE: guestPhone,
    GUEST_EMAIL: guestEmail,
    GOVT_ID_TYPE: govtIdType,
    GOVT_ID_NUMBER: govtIdNumber,
    GUEST_ADDRESS: guestAddress,
    GUEST_STATUS: guestStatus,
    ROOM_NUMBER: roomNumberDisplay,
    ROOM_TYPE_NAME: roomTypeNameDisplay,
    CHECK_IN_FORMATTED: `${checkInDateFormatted} (${checkInTimeFormatted})`,
    CHECK_OUT_FORMATTED: `${checkOutDateFormatted} (${checkOutTimeFormatted})`,
    NIGHTS_LABEL: nightsLabel,
    LATE_CHECKOUT_BANNER: lateCheckoutBanner,
    ACCOMPANYING_MEMBERS_SECTION: accompanyingMembersSection,
    ROOM_TARIFF_ROWS: roomTariffRows,
    PAYMENT_LEDGER_COUNT: String(paymentHistory.length),
    PAYMENT_LEDGER_ROWS: paymentLedgerRows,
    TAXABLE_AMOUNT: taxableVal.toLocaleString('en-IN'),
    CGST_AMOUNT: cgstVal.toLocaleString('en-IN'),
    SGST_AMOUNT: sgstVal.toLocaleString('en-IN'),
    TOTAL_GST_AMOUNT: totalGst.toLocaleString('en-IN'),
    EXTRA_POS_ROW: extraPosRow,
    LATE_CHECKOUT_ROW: lateCheckoutRow,
    GRAND_TOTAL_AMOUNT: grandTotalAmount.toLocaleString('en-IN'),
    PAID_AMOUNT: paidAmount.toLocaleString('en-IN'),
    OUTSTANDING_BALANCE: dueAmount <= 0 ? '0 (✓ Settled)' : dueAmount.toLocaleString('en-IN'),
    BALANCE_CLASS: dueAmount <= 0 ? 'balance-settled' : 'balance-due',
    BALANCE_COLOR: dueAmount <= 0 ? '#059669' : '#DC2626',
    ID_PROOFS_SECTION: idProofsSection,
  };

  let html = template;
  for (const [key, val] of Object.entries(replacements)) {
    html = html.split(`{{${key}}}`).join(val ?? '');
  }

  return html;
}

/**
 * Generate PDF buffer using Puppeteer
 */
export async function generateFolioPdfBuffer(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
    await page.setContent(html, {
      waitUntil: ['load', 'domcontentloaded'],
      timeout: 10000,
    });
  } catch (navErr) {
    console.warn('Puppeteer setContent warning (continuing render):', navErr);
  }

  const pdfUint8Array = await page.pdf({
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margin: {
      top: '10mm',
      bottom: '10mm',
      left: '12mm',
      right: '12mm',
    },
  });

  await page.close();
  return Buffer.from(pdfUint8Array);
}

/**
 * Simple reusable function: generates the PDF, stores it in uploads/folios on the server,
 * and returns the relative file path.
 */
export async function generateGuestFolioPdf(params: GenerateFolioPdfParams): Promise<string> {
  const uploadDir = path.join(process.cwd(), 'uploads', 'folios');

  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const guest = params.guest || {};
  const booking = params.activeBooking || {};
  const guestName = (guest.fullName || guest.name || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_');
  const bookingNum = (booking.bookingNumber || `bk_${Date.now().toString().slice(-6)}`).replace(/[^a-zA-Z0-9_-]/g, '_');

  const filename = `guest_folio_${guestName}_${bookingNum}.pdf`;
  const localFilePath = path.join(uploadDir, filename);

  const html = buildFolioHtml(params);
  const buffer = await generateFolioPdfBuffer(html);

  fs.writeFileSync(localFilePath, buffer);

  // Return relative file path
  return `/uploads/folios/${filename}`;
}
