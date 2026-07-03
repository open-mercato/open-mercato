import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CLAIM_STATUS_TRANSITIONS } from '../data/constants'
import type { WarrantyClaimLineStatus, WarrantyClaimStatus } from '../data/validators'

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

export function isTerminal(status: WarrantyClaimStatus): boolean {
  return nextStatuses(status).length === 0
}

export function canResolveWithLineStatuses(lines: readonly ClaimLineRollupInput[]): boolean {
  return lines.every((line) => {
    if (isDeleted(line)) return true
    const status = lineStatus(line)
    return Boolean(status && resolvedHeaderLineStatuses.has(status))
  })
}

export function computeHeaderRollups(lines: readonly ClaimLineRollupInput[]): {
  totalClaimedAmount: number
  totalApprovedAmount: number
} {
  let totalClaimedAmount = 0
  let totalApprovedAmount = 0

  for (const line of lines) {
    if (isDeleted(line)) continue
    const creditAmount = lineCreditAmount(line)
    totalClaimedAmount += creditAmount

    const status = lineStatus(line)
    if (status && approvedRollupStatuses.has(status)) {
      totalApprovedAmount += creditAmount - lineRestockingFee(line) + lineCoreCreditAmount(line)
    }
  }

  return { totalClaimedAmount, totalApprovedAmount }
}
