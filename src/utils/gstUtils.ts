/**
 * Centralized Enterprise GST & Tax Calculation Utility (Backend)
 */

export const roundMoney = (num: number): number => {
  return Math.round((Number(num) || 0) * 100) / 100;
};

export interface SingleRoomGSTParams {
  basePrice: number;
  gstEnabled?: boolean;
  gstRate?: number;
  taxInclusive?: boolean;
  nights?: number;
  isInterstate?: boolean;
}

export interface SingleRoomGSTResult {
  nightlyPrice: number;
  nights: number;
  taxableAmount: number;
  effGstRate: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  totalGstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  roomGrandTotal: number;
  taxInclusive: boolean;
  gstEnabled: boolean;
}

export function calculateSingleRoomGST({
  basePrice = 0,
  gstEnabled = true,
  gstRate = 18,
  taxInclusive = false,
  nights = 1,
  isInterstate = false,
}: SingleRoomGSTParams): SingleRoomGSTResult {
  const p = Number(basePrice) || 0;
  const n = Math.max(1, Number(nights) || 1);
  const totalTariff = p * n;

  const effGstRate = gstEnabled ? Math.max(0, Number(gstRate) || 0) : 0;

  let taxableAmount = 0;
  let totalGstAmount = 0;
  let roomGrandTotal = 0;

  if (effGstRate === 0 || !gstEnabled) {
    taxableAmount = roundMoney(totalTariff);
    totalGstAmount = 0;
    roomGrandTotal = roundMoney(totalTariff);
  } else if (taxInclusive) {
    roomGrandTotal = roundMoney(totalTariff);
    taxableAmount = roundMoney(totalTariff / (1 + effGstRate / 100));
    totalGstAmount = roundMoney(roomGrandTotal - taxableAmount);
  } else {
    taxableAmount = roundMoney(totalTariff);
    totalGstAmount = roundMoney(taxableAmount * (effGstRate / 100));
    roomGrandTotal = roundMoney(taxableAmount + totalGstAmount);
  }

  let cgstRate = 0;
  let sgstRate = 0;
  let igstRate = 0;
  let cgstAmount = 0;
  let sgstAmount = 0;
  let igstAmount = 0;

  if (effGstRate > 0) {
    if (isInterstate) {
      igstRate = effGstRate;
      igstAmount = totalGstAmount;
    } else {
      cgstRate = roundMoney(effGstRate / 2);
      sgstRate = roundMoney(effGstRate / 2);
      cgstAmount = roundMoney(totalGstAmount / 2);
      sgstAmount = roundMoney(totalGstAmount - cgstAmount);
    }
  }

  return {
    nightlyPrice: p,
    nights: n,
    taxableAmount,
    effGstRate,
    cgstRate,
    sgstRate,
    igstRate,
    totalGstAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    roomGrandTotal,
    taxInclusive: Boolean(taxInclusive),
    gstEnabled: Boolean(gstEnabled),
  };
}

export interface MultiRoomBookingGSTParams {
  selectedRooms: any[];
  nights?: number;
  discountAmount?: number;
  securityDepositAmount?: number;
  extraChargesTotal?: number;
  isInterstate?: boolean;
  defaultGstRate?: number;
  defaultTaxInclusive?: boolean;
}

export function calculateMultiRoomBookingGST({
  selectedRooms = [],
  nights = 1,
  discountAmount = 0,
  securityDepositAmount = 0,
  extraChargesTotal = 0,
  isInterstate = false,
  defaultGstRate = 18,
  defaultTaxInclusive = false,
}: MultiRoomBookingGSTParams) {
  const n = Math.max(1, Number(nights) || 1);

  let totalTaxableAmount = 0;
  let totalGstAmount = 0;
  let totalCgstAmount = 0;
  let totalSgstAmount = 0;
  let totalIgstAmount = 0;
  let totalRoomTariffGross = 0;

  const roomBreakdowns = (selectedRooms || []).map((room) => {
    const roomPrice = Number(room.customPricePerNight || room.basePrice || room.price || 0);
    const roomGstEnabled = room.gstEnabled !== undefined ? Boolean(room.gstEnabled) : true;
    const roomGstRate = room.gstRate !== undefined && room.gstRate !== null ? Number(room.gstRate) : defaultGstRate;
    const roomTaxInclusive = room.taxInclusive !== undefined ? Boolean(room.taxInclusive) : defaultTaxInclusive;

    const breakdown = calculateSingleRoomGST({
      basePrice: roomPrice,
      gstEnabled: roomGstEnabled,
      gstRate: roomGstRate,
      taxInclusive: roomTaxInclusive,
      nights: n,
      isInterstate,
    });

    totalTaxableAmount += breakdown.taxableAmount;
    totalGstAmount += breakdown.totalGstAmount;
    totalCgstAmount += breakdown.cgstAmount;
    totalSgstAmount += breakdown.sgstAmount;
    totalIgstAmount += breakdown.igstAmount;
    totalRoomTariffGross += breakdown.roomGrandTotal;

    return {
      roomId: room._id || room.id,
      roomNumber: room.roomNumber || "N/A",
      roomType: room.roomType?.name || room.roomType || "Standard Room",
      ...breakdown,
    };
  });

  totalTaxableAmount = roundMoney(totalTaxableAmount);
  totalGstAmount = roundMoney(totalGstAmount);
  totalCgstAmount = roundMoney(totalCgstAmount);
  totalSgstAmount = roundMoney(totalSgstAmount);
  totalIgstAmount = roundMoney(totalIgstAmount);
  totalRoomTariffGross = roundMoney(totalRoomTariffGross);

  const disc = roundMoney(Number(discountAmount) || 0);
  const deposit = roundMoney(Number(securityDepositAmount) || 0);
  const extras = roundMoney(Number(extraChargesTotal) || 0);

  const grandTotal = roundMoney(Math.max(0, totalRoomTariffGross - disc) + deposit + extras);

  return {
    roomBreakdowns,
    taxableAmount: totalTaxableAmount,
    totalGstAmount,
    cgstAmount: totalCgstAmount,
    sgstAmount: totalSgstAmount,
    igstAmount: totalIgstAmount,
    totalRoomTariffGross,
    discountAmount: disc,
    securityDepositAmount: deposit,
    extraChargesTotal: extras,
    grandTotal,
  };
}
