import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CLAIM_STATUS_TRANSITIONS } from '../data/constants'
import type { WarrantyClaimLineStatus, WarrantyClaimStatus } from '../data/validators'
import { claimTypeAllowsLineFinancialAdjustments } from './claimTypeConfig'
import { decimalToNumber, decimalToString, parseDecimal, toDecimal, type DecimalValue } from '@open-mercato/shared/lib/decimal'

type AmountValue = number | string | null | undefined

export type ClaimLineRollupInput = {
  creditAmount?: AmountValue
  credit_amount?: AmountValue
  restockingFee?: AmountValue
  restocking_fee?: AmountValue
  coreCreditAmount?: AmountValue
  core_credit_amount?: AmountValue
  lineStatus?: WarrantyClaimLineStatus | null
  line_status?: WarrantyClaimLineStatus | null
  deletedAt?: Date | string | null
  deleted_at?: Date | string | null
}

export const lineStatusGuards: Record<WarrantyClaimLineStatus, readonly WarrantyClaimLineStatus[]> = {
  // `approved -> resolved` supports the credit-only / field-destroy flow where no
  // physical return is received (the line is resolved without the goods lifecycle).
  pending: ['approved', 'rejected'],
  approved: ['received', 'resolved'],
  rejected: [],
  received: ['inspected'],
  inspected: ['resolved'],
  resolved: [],
}

const approvedRollupStatuses = new Set<WarrantyClaimLineStatus>(['approved', 'received', 'inspected', 'resolved'])
const resolvedHeaderLineStatuses = new Set<WarrantyClaimLineStatus>(['rejected', 'resolved'])
const terminalStatuses = new Set<WarrantyClaimStatus>(['closed', 'cancelled'])

function amount(value: AmountValue): DecimalValue {
  return parseDecimal(value) ?? toDecimal(0)
}

function lineCreditAmount(line: ClaimLineRollupInput): DecimalValue {
  return amount(line.creditAmount ?? line.credit_amount)
}

function lineRestockingFee(line: ClaimLineRollupInput): DecimalValue {
  return amount(line.restockingFee ?? line.restocking_fee)
}

function lineCoreCreditAmount(line: ClaimLineRollupInput): DecimalValue {
  return amount(line.coreCreditAmount ?? line.core_credit_amount)
}

function lineStatus(line: ClaimLineRollupInput): WarrantyClaimLineStatus | null {
  return line.lineStatus ?? line.line_status ?? null
}

function isDeleted(line: ClaimLineRollupInput): boolean {
  return Boolean(line.deletedAt ?? line.deleted_at ?? null)
}

export function nextStatuses(status: WarrantyClaimStatus): WarrantyClaimStatus[] {
  return [...(CLAIM_STATUS_TRANSITIONS[status] ?? [])]
}

export function canTransition(from: WarrantyClaimStatus, to: WarrantyClaimStatus): boolean {
  return nextStatuses(from).includes(to)
}

export function assertTransition(from: WarrantyClaimStatus, to: WarrantyClaimStatus): void {
  if (canTransition(from, to)) return
  throw new CrudHttpError(400, { error: 'warranty_claims.errors.invalidTransition' })
}

export function isTerminal(status: string): boolean {
  return (terminalStatuses as Set<string>).has(status)
}

export function canResolveWithLineStatuses(lines: readonly ClaimLineRollupInput[]): boolean {
  return lines.every((line) => {
    if (isDeleted(line)) return true
    const status = lineStatus(line)
    return Boolean(status && resolvedHeaderLineStatuses.has(status))
  })
}

export function computeHeaderRollups(
  lines: readonly ClaimLineRollupInput[],
  options?: { claimType?: string | null },
): {
  totalClaimedAmount: number
  totalClaimedAmountExact: string
  totalApprovedAmount: number
  totalApprovedAmountExact: string
} {
  // Restocking / core adjustments only belong to return-family claims. When a claimType is
  // supplied, warranty and vendor-recovery claims roll up the credit amount alone so they can
  // never inherit a return's restock/core math (LINE-05). When omitted, behavior is unchanged.
  const applyFinancialAdjustments = options?.claimType === undefined
    ? true
    : claimTypeAllowsLineFinancialAdjustments(options.claimType)
  const zero = toDecimal(0)
  const atLeastZero = (value: DecimalValue) => (value.lt(0) ? zero : value)
  let totalClaimedAmount = zero
  let totalApprovedAmount = zero

  for (const line of lines) {
    if (isDeleted(line)) continue
    const creditAmount = lineCreditAmount(line)
    totalClaimedAmount = totalClaimedAmount.plus(creditAmount)

    const status = lineStatus(line)
    if (status && approvedRollupStatuses.has(status)) {
      // A restocking fee larger than the line's credit must not drag the
      // approved header total negative — clamp the line contribution at zero.
      totalApprovedAmount = totalApprovedAmount.plus(
        applyFinancialAdjustments
          ? atLeastZero(creditAmount.minus(lineRestockingFee(line)).plus(lineCoreCreditAmount(line)))
          : atLeastZero(creditAmount),
      )
    }
  }

  return {
    totalClaimedAmount: decimalToNumber(totalClaimedAmount),
    totalClaimedAmountExact: decimalToString(totalClaimedAmount),
    totalApprovedAmount: decimalToNumber(totalApprovedAmount),
    totalApprovedAmountExact: decimalToString(totalApprovedAmount),
  }
}
