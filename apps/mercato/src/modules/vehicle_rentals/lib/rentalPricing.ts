import { computeVatFromNet, roundToHalalas } from '../../saudi_localization/lib/saudi/vat'
import type { RentalDurationType } from '../data/entities'

/**
 * The rental period arithmetic, as pure functions.
 *
 * A rental is billed in whole periods: three days on a daily rate, ten days on
 * a weekly rate (two weeks), forty days on a monthly rate (two months). The
 * included mileage scales with the *billed* periods, so the extra kilometres an
 * operator charges for are the ones past what the customer already paid for —
 * and every amount rounds through the Saudi halala primitives so the rental
 * document and the VAT invoice agree to the halala.
 */

export type RentalPeriods = {
  days: number
  periods: number
}

export function rentalPeriods(
  durationType: RentalDurationType,
  startAt: string | Date | null | undefined,
  endAt: string | Date | null | undefined,
): RentalPeriods {
  if (!startAt || !endAt) return { days: 0, periods: 0 }
  const start = new Date(startAt).getTime()
  const end = new Date(endAt)
  end.setHours(23, 59, 59, 999)
  const millis = end.getTime() - start
  if (!Number.isFinite(millis) || millis <= 0) return { days: 0, periods: 0 }
  const days = Math.max(1, Math.ceil(millis / 86_400_000))
  if (durationType === 'daily') return { days, periods: days }
  if (durationType === 'weekly') return { days, periods: Math.ceil(days / 7) }
  return { days, periods: Math.ceil(days / 30) }
}

export type RentalAmountInput = {
  durationType: RentalDurationType
  startAt: string | Date | null | undefined
  endAt: string | Date | null | undefined
  dailyRate: string | number | null | undefined
  weeklyRate: string | number | null | undefined
  monthlyRate: string | number | null | undefined
  includedKm?: number | null
  extraKmRate?: string | number | null
  odoStartKm?: number | null
  odoEndKm?: number | null
  taxRate?: string | number | null
}

export type RentalAmountOutcome = {
  days: number
  periods: number
  includedKm: number | null
  usageKm: number | null
  extraKm: number | null
  rentalAmountNet: string
  extraKmAmountNet: string
  totalNetAmount: string
  taxAmount: string
  totalGrossAmount: string
}

function amount(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function toAmountString(value: number): string {
  return roundToHalalas(value).toFixed(2)
}

export function computeRentalAmounts(input: RentalAmountInput): RentalAmountOutcome {
  const { days, periods } = rentalPeriods(input.durationType, input.startAt, input.endAt)
  const baseRate = input.durationType === 'daily'
    ? amount(input.dailyRate)
    : input.durationType === 'weekly'
      ? amount(input.weeklyRate)
      : amount(input.monthlyRate)
  const rentalNet = periods * baseRate

  const includedKm = input.includedKm === null || input.includedKm === undefined
    ? null
    : input.includedKm * periods
  const usageKm = input.odoStartKm !== null && input.odoStartKm !== undefined
    && input.odoEndKm !== null && input.odoEndKm !== undefined
    ? Math.max(0, input.odoEndKm - input.odoStartKm)
    : null
  const extraKm = usageKm !== null && includedKm !== null
    ? Math.max(0, usageKm - includedKm)
    : null
  const extraAmount = extraKm !== null ? extraKm * amount(input.extraKmRate) : 0

  const totalNet = rentalNet + extraAmount
  const envelope = computeVatFromNet(totalNet, amount(input.taxRate) / 100)

  return {
    days,
    periods,
    includedKm,
    usageKm,
    extraKm,
    rentalAmountNet: toAmountString(rentalNet),
    extraKmAmountNet: toAmountString(extraAmount),
    totalNetAmount: toAmountString(totalNet),
    taxAmount: toAmountString(envelope.vat),
    totalGrossAmount: toAmountString(envelope.gross),
  }
}
