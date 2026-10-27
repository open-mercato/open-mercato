import { AVAILABILITY_POLICY_INTEGER_MAX } from '../../../data/validators'

export function toIsoDateTimeOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return trimmed
  return parsed.toISOString()
}

export const AVAILABILITY_POLICY_INTEGER_FIELDS = [
  'backorderLeadTimeDays',
  'lowStockThreshold',
  'minOrderQuantity',
  'maxOrderQuantity',
  'quantityIncrement',
] as const

export type AvailabilityPolicyIntegerField = (typeof AVAILABILITY_POLICY_INTEGER_FIELDS)[number]

export function findIntegerFieldAboveMax(
  values: Record<AvailabilityPolicyIntegerField, number | null>,
): AvailabilityPolicyIntegerField | null {
  return AVAILABILITY_POLICY_INTEGER_FIELDS.find((field) => {
    const value = values[field]
    return value != null && value > AVAILABILITY_POLICY_INTEGER_MAX
  }) ?? null
}
