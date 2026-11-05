import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { WarrantyClaim, WarrantyClaimLine } from '../data/entities'
import { evaluateClaimRisk, type ClaimRiskAssessment } from './risk'
import { addWarrantyMonths } from './warrantyPreview'
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

export type WarrantyClaimTriageReason = {
  messageKey: string
  params?: Record<string, string | number>
}

export type WarrantyEligibilitySuggestion = {
  status: WarrantyClaimWarrantyStatus
  purchaseDate: string | null
  warrantyMonths: number | null
  warrantyExpiresAt: string | null
  reason: WarrantyClaimTriageReason
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
  reason: WarrantyClaimTriageReason
  restockingFeePercent: number | null
}

export type WarrantyClaimPrioritySuggestion = {
  currentPriority: WarrantyClaimPriority
  suggestedPriority: WarrantyClaimPriority
  ageHours: number | null
  slaDueAt: string | null
  overdue: boolean
  reason: WarrantyClaimTriageReason
}

export type WarrantyClaimReviewEligibility = {
  status: 'fast_track_candidate' | 'review_required'
  reason: WarrantyClaimTriageReason
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
  eligibility: WarrantyClaimReviewEligibility
  priority: WarrantyClaimPrioritySuggestion
  lines: WarrantyClaimLineTriageSuggestion[]
  risk: ClaimRiskAssessment
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


function reason(messageKey: string, params?: Record<string, string | number>): WarrantyClaimTriageReason {
  return params ? { messageKey, params } : { messageKey }
}

function parseAmount(value: string | number | null | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function resolveEligibility(line: WarrantyClaimLine, now: Date): WarrantyEligibilitySuggestion {
  // An unparseable purchase date is missing data, not an expired warranty — a
  // truthy Invalid Date would otherwise fall through and be denied as
  // out_of_warranty. Mirrors computeWarrantyEntitlementPreview.
  if (
    !line.purchaseDate
    || Number.isNaN(line.purchaseDate.getTime())
    || line.warrantyMonths === null
    || line.warrantyMonths === undefined
    || !Number.isFinite(line.warrantyMonths)
  ) {
    return {
      status: 'unknown',
      purchaseDate: toDateOnlyIso(line.purchaseDate),
      warrantyMonths: line.warrantyMonths ?? null,
      warrantyExpiresAt: toDateOnlyIso(line.warrantyExpiresAt),
      reason: reason('warranty_claims.triage.reason.missingWarrantyData'),
    }
  }

  const expiresAt = addWarrantyMonths(line.purchaseDate, line.warrantyMonths)
  const status: WarrantyClaimWarrantyStatus = expiresAt.getTime() >= now.getTime() ? 'in_warranty' : 'out_of_warranty'
  return {
    status,
    purchaseDate: toDateOnlyIso(line.purchaseDate),
    warrantyMonths: line.warrantyMonths,
    warrantyExpiresAt: toDateOnlyIso(expiresAt),
    reason: status === 'in_warranty'
      ? reason('warranty_claims.triage.reason.warrantyStillValid')
      : reason('warranty_claims.triage.reason.warrantyExpired'),
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
      reason: reason('warranty_claims.triage.reason.coreAcceptancePath'),
      restockingFeePercent: null,
    }
  }

  if (eligibility.status === 'in_warranty') {
    if (qtyClaimed <= 1) {
      return {
        suggestedDisposition: 'replace',
        suggestedPath: 'replace',
        reason: reason('warranty_claims.triage.reason.inWarrantyLowQuantity'),
        restockingFeePercent: null,
      }
    }
    return {
      suggestedDisposition: 'repair',
      suggestedPath: 'repair_review',
      reason: reason('warranty_claims.triage.reason.inWarrantyInspection'),
      restockingFeePercent: null,
    }
  }

  if (eligibility.status === 'out_of_warranty' && claimType === 'return') {
    return {
      suggestedDisposition: 'credit',
      suggestedPath: 'credit_with_restocking_fee',
      reason: reason('warranty_claims.triage.reason.outOfWarrantyReturnRestocking'),
      restockingFeePercent: 15,
    }
  }

  if (eligibility.status === 'out_of_warranty') {
    return {
      suggestedDisposition: 'deny',
      suggestedPath: 'deny',
      reason: reason('warranty_claims.triage.reason.outsideWarrantyWindow'),
      restockingFeePercent: null,
    }
  }

  return {
    suggestedDisposition: 'repair',
    suggestedPath: 'repair_review',
    reason: reason('warranty_claims.triage.reason.unknownEligibilityInspection'),
    restockingFeePercent: null,
  }
}

function hoursBetween(from: Date | null | undefined, to: Date): number | null {
  if (!from) return null
  return Math.max(0, Math.round(((to.getTime() - from.getTime()) / 3_600_000) * 10) / 10)
}

const priorityRank: Record<WarrantyClaimPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
}

function atLeastPriority(priority: WarrantyClaimPriority, minimum: WarrantyClaimPriority): WarrantyClaimPriority {
  return priorityRank[priority] >= priorityRank[minimum] ? priority : minimum
}

function suggestPriority(claim: WarrantyClaim, now: Date, risk: ClaimRiskAssessment): WarrantyClaimPrioritySuggestion {
  const ageHours = hoursBetween(claim.submittedAt ?? claim.createdAt, now)
  const slaDueAt = toIso(claim.slaDueAt)
  const overdue = claim.slaDueAt ? claim.slaDueAt.getTime() < now.getTime() : false
  const highRisk = risk.signals.some((signal) => signal.level === 'high')
  if (overdue) {
    return {
      currentPriority: claim.priority,
      suggestedPriority: 'urgent',
      ageHours,
      slaDueAt,
      overdue,
      reason: highRisk
        ? reason('warranty_claims.triage.reason.highRiskPriority')
        : reason('warranty_claims.triage.reason.slaOverdue'),
    }
  }
  if (highRisk) {
    return {
      currentPriority: claim.priority,
      suggestedPriority: atLeastPriority(claim.priority, 'high'),
      ageHours,
      slaDueAt,
      overdue,
      reason: reason('warranty_claims.triage.reason.highRiskPriority'),
    }
  }
  if (claim.slaDueAt && claim.slaDueAt.getTime() - now.getTime() <= 6 * 3_600_000) {
    return {
      currentPriority: claim.priority,
      suggestedPriority: 'high',
      ageHours,
      slaDueAt,
      overdue,
      reason: reason('warranty_claims.triage.reason.slaDueSoon', { hours: 6 }),
    }
  }
  if (ageHours !== null && ageHours >= 36) {
    return {
      currentPriority: claim.priority,
      suggestedPriority: 'high',
      ageHours,
      slaDueAt,
      overdue,
      reason: reason('warranty_claims.triage.reason.openAtLeastHours', { hours: 36 }),
    }
  }
  return {
    currentPriority: claim.priority,
    suggestedPriority: claim.priority === 'low' ? 'normal' : claim.priority,
    ageHours,
    slaDueAt,
    overdue,
    reason: claim.priority === 'low'
      ? reason('warranty_claims.triage.reason.lowPriorityEscalation')
      : reason('warranty_claims.triage.reason.priorityConsistent'),
  }
}

function serializeLineSuggestion(
  claimType: WarrantyClaimType,
  line: WarrantyClaimLine,
  now: Date,
  risk: ClaimRiskAssessment,
): WarrantyClaimLineTriageSuggestion {
  const qtyClaimed = parseAmount(line.qtyClaimed, 1)
  const eligibility = resolveEligibility(line, now)
  const disposition = suggestLineDisposition(claimType, qtyClaimed, eligibility)
  const riskAdjustedDisposition = risk.signals.length > 0 && disposition.suggestedPath === 'replace'
    ? {
        suggestedDisposition: 'repair' as const,
        suggestedPath: 'repair_review' as const,
        reason: reason('warranty_claims.triage.reason.riskSignalsRequireReview'),
        restockingFeePercent: null,
      }
    : disposition
  return {
    lineId: line.id,
    lineNo: line.lineNo,
    sku: line.sku ?? null,
    productName: line.productName ?? null,
    serialNumber: line.serialNumber ?? null,
    qtyClaimed,
    eligibility,
    ...riskAdjustedDisposition,
  }
}

function resolveReviewEligibility(
  lines: readonly WarrantyClaimLineTriageSuggestion[],
  risk: ClaimRiskAssessment,
): WarrantyClaimReviewEligibility {
  if (risk.signals.length > 0) {
    return {
      status: 'review_required',
      reason: reason('warranty_claims.triage.reason.riskSignalsReviewRequired', { count: risk.signals.length }),
    }
  }
  // `every` is vacuously true for an empty list, which would fast-track a claim
  // that has no lines at all — the one case that most needs a human.
  if (
    lines.length > 0
    && lines.every((line) => line.eligibility.status === 'in_warranty' && line.suggestedPath === 'replace')
  ) {
    return {
      status: 'fast_track_candidate',
      reason: reason('warranty_claims.triage.reason.fastTrackCandidate'),
    }
  }
  return {
    status: 'review_required',
    reason: reason('warranty_claims.triage.reason.lineReviewRequired'),
  }
}

export async function buildWarrantyClaimTriageSuggestion(input: {
  em: EntityManager
  claimId: string
  scope: WarrantyClaimTriageScope
  now?: Date
  risk?: ClaimRiskAssessment
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
  const risk = input.risk ?? await evaluateClaimRisk(input.em, claim, lines)
  const lineSuggestions = lines.map((line) => serializeLineSuggestion(claim.claimType, line, now, risk))
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
    eligibility: resolveReviewEligibility(lineSuggestions, risk),
    priority: suggestPriority(claim, now, risk),
    lines: lineSuggestions,
    risk,
    generatedAt: now.toISOString(),
  }
}
