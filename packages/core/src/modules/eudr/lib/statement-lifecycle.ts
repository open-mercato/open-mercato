import type { EudrStatementStatus } from '../data/validators'
import { getCountryRiskTier } from './reference-data'

export const EUDR_STATEMENT_TRANSITIONS: Record<EudrStatementStatus, readonly EudrStatementStatus[]> = {
  draft: ['submitted', 'archived'],
  submitted: ['draft', 'available', 'archived'],
  available: ['withdrawn', 'archived'],
  withdrawn: ['archived'],
  archived: [],
}

export function canTransition(from: EudrStatementStatus, to: EudrStatementStatus): boolean {
  return EUDR_STATEMENT_TRANSITIONS[from].includes(to)
}

export const EUDR_AMEND_GUARDED_FIELDS = [
  'commodity',
  'quantityKg',
  'supplementaryUnit',
  'supplementaryQuantity',
  'referencedStatements',
  'orderId',
] as const

export const EUDR_AMEND_WINDOW_MS = 72 * 60 * 60 * 1000

export function isAmendWindowOpen(referenceIssuedAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (referenceIssuedAt == null) return false
  const issuedAtMs = referenceIssuedAt.getTime()
  if (Number.isNaN(issuedAtMs)) return false
  const elapsedMs = now.getTime() - issuedAtMs
  return elapsedMs >= 0 && elapsedMs <= EUDR_AMEND_WINDOW_MS
}

export type GateSubmissionView = { status: string; completenessScore: number; originCountry: string | null }
export type GateAssessmentView = {
  conclusion: string
  countryRisks: Array<{ country: string; tier: string }>
  reviewDueAt: Date | string | null
  hasConcernAnswers: boolean
  hasCompletedMitigation: boolean
} | null
export type GateResult = { allowed: boolean; reasons: string[] }

function normalizeCountry(value: string | null): string | null {
  const normalized = value?.trim().toUpperCase() ?? ''
  return normalized.length > 0 ? normalized : null
}

function parseDate(value: Date | string | null): Date | null {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function hasSameCountries(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false
  for (const country of left) {
    if (!right.has(country)) return false
  }
  return true
}

export function evaluateSubmissionGate(input: {
  actorRole: string | null
  referencedStatementsCount: number
  submissions: GateSubmissionView[]
  latestAssessment: GateAssessmentView
  now?: Date
}): GateResult {
  const reasons: string[] = []

  if (input.actorRole === 'sme_trader') {
    if (input.referencedStatementsCount < 1) reasons.push('referencedStatementsRequired')
    return { allowed: reasons.length === 0, reasons }
  }

  if (input.submissions.length === 0) reasons.push('noSubmissions')
  if (input.submissions.some((submission) => submission.status !== 'verified' || submission.completenessScore !== 100)) {
    reasons.push('submissionsNotReady')
  }
  if (input.submissions.some((submission) => normalizeCountry(submission.originCountry) === null)) {
    reasons.push('originCountryMissing')
  }

  const currentCountries = new Set(
    input.submissions
      .map((submission) => normalizeCountry(submission.originCountry))
      .filter((country): country is string => country !== null),
  )
  const allCountriesPresent = input.submissions.length > 0 && input.submissions.every((submission) => normalizeCountry(submission.originCountry) !== null)
  const tiers = [...currentCountries].map((country) => getCountryRiskTier(country))
  const simplifiedDueDiligenceSatisfied = allCountriesPresent && tiers.length > 0 && tiers.every((tier) => tier === 'low')

  if (!simplifiedDueDiligenceSatisfied) {
    const assessment = input.latestAssessment
    if (assessment == null || assessment.conclusion !== 'negligible') reasons.push('riskConclusionMissing')
    if (assessment != null) {
      const assessedCountries = new Set(assessment.countryRisks.map((risk) => risk.country.trim().toUpperCase()).filter((country) => country.length > 0))
      if (!hasSameCountries(currentCountries, assessedCountries)) reasons.push('riskAssessmentStale')

      const reviewDueAt = parseDate(assessment.reviewDueAt)
      if (reviewDueAt !== null && reviewDueAt.getTime() < (input.now ?? new Date()).getTime()) reasons.push('riskReviewOverdue')
      if (assessment.hasConcernAnswers && !assessment.hasCompletedMitigation) reasons.push('mitigationIncomplete')
    }
  }

  return { allowed: reasons.length === 0, reasons }
}
