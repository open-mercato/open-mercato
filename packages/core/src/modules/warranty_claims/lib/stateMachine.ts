import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CLAIM_STATUS_TRANSITIONS } from '../data/constants'
import type { WarrantyClaimLineStatus, WarrantyClaimStatus } from '../data/validators'
import { claimTypeAllowsLineFinancialAdjustments } from './claimTypeConfig'

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

function amount(value: AmountValue): number {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function lineCreditAmount(line: ClaimLineRollupInput): number {
  return amount(line.creditAmount ?? line.credit_amount)
}

function lineRestockingFee(line: ClaimLineRollupInput): number {
  return amount(line.restockingFee ?? line.restocking_fee)
}

function lineCoreCreditAmount(line: ClaimLineRollupInput): number {
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

// Matches the numeric(18,4) scale of the warranty_claims total columns so the
// float sums serialize without artifacts like "0.30000000000000004".
const ROLLUP_AMOUNT_SCALE = 10_000

function roundRollupAmount(value: number): number {
  return Math.round((value + Number.EPSILON) * ROLLUP_AMOUNT_SCALE) / ROLLUP_AMOUNT_SCALE
}

export function computeHeaderRollups(
  lines: readonly ClaimLineRollupInput[],
  options?: { claimType?: string | null },
): {
  totalClaimedAmount: number
  totalApprovedAmount: number
} {
  // Restocking / core adjustments only belong to return-family claims. When a claimType is
  // supplied, warranty and vendor-recovery claims roll up the credit amount alone so they can
  // never inherit a return's restock/core math (LINE-05). When omitted, behavior is unchanged.
  const applyFinancialAdjustments = options?.claimType === undefined
    ? true
    : claimTypeAllowsLineFinancialAdjustments(options.claimType)
  let totalClaimedAmount = 0
  let totalApprovedAmount = 0

  for (const line of lines) {
    if (isDeleted(line)) continue
    const creditAmount = lineCreditAmount(line)
    totalClaimedAmount += creditAmount

    const status = lineStatus(line)
    if (status && approvedRollupStatuses.has(status)) {
      // A restocking fee larger than the line's credit must not drag the
      // approved header total negative — clamp the line contribution at zero.
      totalApprovedAmount += applyFinancialAdjustments
        ? Math.max(0, creditAmount - lineRestockingFee(line) + lineCoreCreditAmount(line))
        : Math.max(0, creditAmount)
    }
  }

  return {
    totalClaimedAmount: roundRollupAmount(totalClaimedAmount),
    totalApprovedAmount: roundRollupAmount(totalApprovedAmount),
  }
}
