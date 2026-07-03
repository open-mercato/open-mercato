import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { WarrantyClaim, WarrantyClaimLine } from '../data/entities'
import type {
  WarrantyClaimDisposition,
  WarrantyClaimPriority,
  WarrantyClaimType,
  WarrantyClaimWarrantyStatus,
} from '../data/validators'

export type WarrantyClaimTriageScope = {
  tenantId: string
  organizationId: string
}

export type WarrantyEligibilitySuggestion = {
  status: WarrantyClaimWarrantyStatus
  purchaseDate: string | null
  warrantyMonths: number | null
  warrantyExpiresAt: string | null
  reason: string
}

export type WarrantyClaimLineTriageSuggestion = {
  lineId: string
  lineNo: number
  sku: string | null
  productName: string | null
  serialNumber: string | null
  qtyClaimed: number
  eligibility: WarrantyEligibilitySuggestion
  suggestedDisposition: WarrantyClaimDisposition
  suggestedPath: 'replace' | 'repair_review' | 'deny' | 'credit_with_restocking_fee' | 'core_accept'
  reason: string
  restockingFeePercent: number | null
}

export type WarrantyClaimPrioritySuggestion = {
  currentPriority: WarrantyClaimPriority
  suggestedPriority: WarrantyClaimPriority
  ageHours: number | null
  slaDueAt: string | null
  overdue: boolean
  reason: string
}

export type WarrantyClaimTriageSuggestion = {
  claim: {
    id: string
    claimNumber: string
    claimType: WarrantyClaimType
    status: string
    customerName: string | null
    submittedAt: string | null
    slaDueAt: string | null
  }
  priority: WarrantyClaimPrioritySuggestion
  lines: WarrantyClaimLineTriageSuggestion[]
  generatedAt: string
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toDateOnlyIso(value: Date | string | null | undefined): string | null {
  const iso = toIso(value)
  return iso ? iso.slice(0, 10) : null
}

function addMonths(date: Date, months: number): Date {
  const copy = new Date(date.getTime())
  copy.setUTCMonth(copy.getUTCMonth() + months)
  return copy
}

function parseAmount(value: string | number | null | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function resolveEligibility(line: WarrantyClaimLine, now: Date): WarrantyEligibilitySuggestion {
  if (!line.purchaseDate || line.warrantyMonths === null || line.warrantyMonths === undefined) {
    return {
      status: 'unknown',
      purchaseDate: toDateOnlyIso(line.purchaseDate),
      warrantyMonths: line.warrantyMonths ?? null,
      warrantyExpiresAt: toDateOnlyIso(line.warrantyExpiresAt),
      reason: 'Purchase date or warranty term is missing.',
    }
  }

  const expiresAt = addMonths(line.purchaseDate, line.warrantyMonths)
  const status: WarrantyClaimWarrantyStatus = expiresAt.getTime() >= now.getTime() ? 'in_warranty' : 'out_of_warranty'
  return {
    status,
    purchaseDate: toDateOnlyIso(line.purchaseDate),
    warrantyMonths: line.warrantyMonths,
    warrantyExpiresAt: toDateOnlyIso(expiresAt),
    reason: status === 'in_warranty'
      ? 'Purchase date plus warranty term is still valid.'
      : 'Purchase date plus warranty term has expired.',
  }
}

function suggestLineDisposition(
  claimType: WarrantyClaimType,
  qtyClaimed: number,
  eligibility: WarrantyEligibilitySuggestion,
): Pick<WarrantyClaimLineTriageSuggestion, 'suggestedDisposition' | 'suggestedPath' | 'reason' | 'restockingFeePercent'> {
  if (claimType === 'core_return') {
    return {
      suggestedDisposition: 'credit',
      suggestedPath: 'core_accept',
      reason: 'Core return lines should follow the core acceptance path before credit is finalized.',
      restockingFeePercent: null,
    }
  }

  if (eligibility.status === 'in_warranty') {
    if (qtyClaimed <= 1) {
      return {
        suggestedDisposition: 'replace',
        suggestedPath: 'replace',
        reason: 'The line is in warranty and the claimed quantity is low.',
        restockingFeePercent: null,
      }
    }
    return {
      suggestedDisposition: 'repair',
      suggestedPath: 'repair_review',
      reason: 'The line is in warranty but quantity warrants inspection before replacement.',
      restockingFeePercent: null,
    }
  }

  if (eligibility.status === 'out_of_warranty' && claimType === 'return') {
    return {
      suggestedDisposition: 'credit',
      suggestedPath: 'credit_with_restocking_fee',
      reason: 'The line is out of warranty, but a non-warranty return can be credited with a restocking fee.',
      restockingFeePercent: 15,
    }
  }

  if (eligibility.status === 'out_of_warranty') {
    return {
      suggestedDisposition: 'deny',
      suggestedPath: 'deny',
      reason: 'The line is outside the computed warranty window.',
      restockingFeePercent: null,
    }
  }

  return {
    suggestedDisposition: 'repair',
    suggestedPath: 'repair_review',
    reason: 'Eligibility is unknown, so inspection is recommended before disposition.',
    restockingFeePercent: null,
  }
}

function hoursBetween(from: Date | null | undefined, to: Date): number | null {
  if (!from) return null
  return Math.max(0, Math.round(((to.getTime() - from.getTime()) / 3_600_000) * 10) / 10)
}

function suggestPriority(claim: WarrantyClaim, now: Date): WarrantyClaimPrioritySuggestion {
  const ageHours = hoursBetween(claim.submittedAt ?? claim.createdAt, now)
  const slaDueAt = toIso(claim.slaDueAt)
  const overdue = claim.slaDueAt ? claim.slaDueAt.getTime() < now.getTime() : false
  if (overdue) {
    return {
      currentPriority: claim.priority,
      suggestedPriority: 'urgent',
      ageHours,
      slaDueAt,
      overdue,
      reason: 'The claim is past its SLA due time.',
    }
  }
  if (claim.slaDueAt && claim.slaDueAt.getTime() - now.getTime() <= 6 * 3_600_000) {
    return {
      currentPriority: claim.priority,
      suggestedPriority: 'high',
      ageHours,
      slaDueAt,
      overdue,
      reason: 'The claim is within six hours of its SLA due time.',
    }
  }
  if (ageHours !== null && ageHours >= 36) {
    return {
      currentPriority: claim.priority,
      suggestedPriority: 'high',
      ageHours,
      slaDueAt,
      overdue,
      reason: 'The claim has been open for at least 36 hours.',
    }
  }
  return {
    currentPriority: claim.priority,
    suggestedPriority: claim.priority === 'low' ? 'normal' : claim.priority,
    ageHours,
    slaDueAt,
    overdue,
    reason: claim.priority === 'low'
      ? 'Claims awaiting triage should not remain low priority.'
      : 'Current priority is consistent with age and SLA.',
  }
}

function serializeLineSuggestion(
  claimType: WarrantyClaimType,
  line: WarrantyClaimLine,
  now: Date,
): WarrantyClaimLineTriageSuggestion {
  const qtyClaimed = parseAmount(line.qtyClaimed, 1)
  const eligibility = resolveEligibility(line, now)
  const disposition = suggestLineDisposition(claimType, qtyClaimed, eligibility)
  return {
    lineId: line.id,
    lineNo: line.lineNo,
    sku: line.sku ?? null,
    productName: line.productName ?? null,
    serialNumber: line.serialNumber ?? null,
    qtyClaimed,
    eligibility,
    ...disposition,
  }
}

export async function buildWarrantyClaimTriageSuggestion(input: {
  em: EntityManager
  claimId: string
  scope: WarrantyClaimTriageScope
  now?: Date
}): Promise<WarrantyClaimTriageSuggestion> {
  const now = input.now ?? new Date()
  const claim = await findOneWithDecryption(
    input.em,
    WarrantyClaim,
    { id: input.claimId, tenantId: input.scope.tenantId, organizationId: input.scope.organizationId, deletedAt: null },
    {},
    input.scope,
  )
  if (!claim) {
    throw new CrudHttpError(404, { error: 'warranty_claims.errors.notFound' })
  }
  const lines = await findWithDecryption(
    input.em,
    WarrantyClaimLine,
    { claim: claim.id, tenantId: input.scope.tenantId, organizationId: input.scope.organizationId, deletedAt: null },
    { orderBy: { lineNo: 'ASC' } },
    input.scope,
  )
  return {
    claim: {
      id: claim.id,
      claimNumber: claim.claimNumber,
      claimType: claim.claimType,
      status: claim.status,
      customerName: claim.customerName ?? null,
      submittedAt: toIso(claim.submittedAt),
      slaDueAt: toIso(claim.slaDueAt),
    },
    priority: suggestPriority(claim, now),
    lines: lines.map((line) => serializeLineSuggestion(claim.claimType, line, now)),
    generatedAt: now.toISOString(),
  }
}
