import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  DocumentFinding,
  DocumentReviewPlaybook,
  DocumentReviewPlaybookReference,
  DocumentReviewRule,
  type DocumentFindingSeverity,
} from '../data/entities'

export type DocumentFindingScope = {
  tenantId: string
  organizationId: string
}

export type DocumentFindingSeverityCounts = Record<DocumentFindingSeverity, number>

export type DocumentReviewPlaybookInfo = {
  id: string
  code: string
  name: string
  version: number | null
}

/**
 * What the latest review checked against: active rules and guidance documents
 * of its playbook. Null when unknown — no playbook, or the playbook changed
 * since the review (rules are not snapshotted per version).
 */
export type DocumentReviewCoverage = {
  rules: number | null
  references: number | null
}

export type DocumentFindingSummary = {
  reviewId: string | null
  reviewedAt: string | null
  source: string | null
  playbook: DocumentReviewPlaybookInfo | null
  coverage: DocumentReviewCoverage
  open: DocumentFindingSeverityCounts
  decided: { applied: number; kept: number }
  unlocated: number
}

export type SerializedDocumentFinding = {
  id: string
  organizationId: string
  documentId: string
  reviewId: string
  source: string
  sourceWorkflowInstanceId: string | null
  sourceAgentRunId: string | null
  playbookId: string | null
  playbookVersion: number | null
  ruleId: string | null
  ruleCode: string | null
  severity: string
  title: string
  explanation: string
  sectionLabel: string | null
  quote: string
  occurrence: number
  suggestedText: string | null
  anchor: Record<string, unknown> | null
  anchorStatus: string
  status: string
  appliedText: string | null
  decisionNote: string | null
  decidedByUserId: string | null
  decidedAt: string | null
  createdByUserId: string
  createdAt: string
  updatedAt: string
}

export const DOCUMENT_FINDING_SUMMARY_SCAN_LIMIT = 1_000

export function emptySeverityCounts(): DocumentFindingSeverityCounts {
  return { blocking: 0, warning: 0, info: 0 }
}

export function countFindingsBySeverity(
  findings: ReadonlyArray<{ severity: DocumentFindingSeverity }>,
): DocumentFindingSeverityCounts {
  const counts = emptySeverityCounts()
  for (const finding of findings) counts[finding.severity] += 1
  return counts
}

export function isReviewClearedTransition(openBlockingBefore: number | null, openBlockingAfter: number): boolean {
  return openBlockingBefore !== null && openBlockingBefore > 0 && openBlockingAfter === 0
}

export function serializeDocumentFinding(finding: DocumentFinding): SerializedDocumentFinding {
  return {
    id: finding.id,
    organizationId: finding.organizationId,
    documentId: finding.documentId,
    reviewId: finding.reviewId,
    source: finding.source,
    sourceWorkflowInstanceId: finding.sourceWorkflowInstanceId ?? null,
    sourceAgentRunId: finding.sourceAgentRunId ?? null,
    playbookId: finding.playbookId ?? null,
    playbookVersion: finding.playbookVersion ?? null,
    ruleId: finding.ruleId ?? null,
    ruleCode: finding.ruleCode ?? null,
    severity: finding.severity,
    title: finding.title,
    explanation: finding.explanation,
    sectionLabel: finding.sectionLabel ?? null,
    quote: finding.quote,
    occurrence: finding.occurrence,
    suggestedText: finding.suggestedText ?? null,
    anchor: finding.anchor ?? null,
    anchorStatus: finding.anchorStatus,
    status: finding.status,
    appliedText: finding.appliedText ?? null,
    decisionNote: finding.decisionNote ?? null,
    decidedByUserId: finding.decidedByUserId ?? null,
    decidedAt: finding.decidedAt ? finding.decidedAt.toISOString() : null,
    createdByUserId: finding.createdByUserId,
    createdAt: finding.createdAt.toISOString(),
    updatedAt: finding.updatedAt.toISOString(),
  }
}

export async function resolveLatestReview(
  em: EntityManager,
  scope: DocumentFindingScope,
  documentId: string,
): Promise<{ reviewId: string; reviewedAt: Date; source: string } | null> {
  const latest = await findOneWithDecryption(
    em,
    DocumentFinding,
    {
      documentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    { orderBy: { createdAt: 'DESC', id: 'DESC' }, fields: ['id', 'reviewId', 'createdAt', 'source'] },
    scope,
  )
  return latest ? { reviewId: latest.reviewId, reviewedAt: latest.createdAt, source: latest.source } : null
}

export async function countOpenBlockingFindings(
  em: EntityManager,
  scope: DocumentFindingScope,
  documentId: string,
  reviewId: string,
): Promise<number> {
  return em.count(DocumentFinding, {
    documentId,
    reviewId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: 'open',
    severity: 'blocking',
    deletedAt: null,
  })
}

export async function countOpenFindings(
  em: EntityManager,
  scope: DocumentFindingScope,
  documentId: string,
): Promise<number> {
  return em.count(DocumentFinding, {
    documentId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: 'open',
    deletedAt: null,
  })
}

/**
 * Open blocking count for the document's latest review, or null when the
 * given review is not the latest one (a decision on an older review can never
 * change the release signal).
 */
export async function countLatestReviewOpenBlocking(
  em: EntityManager,
  scope: DocumentFindingScope,
  documentId: string,
  reviewId: string,
): Promise<number | null> {
  const latest = await resolveLatestReview(em, scope, documentId)
  if (!latest || latest.reviewId !== reviewId) return null
  return countOpenBlockingFindings(em, scope, documentId, reviewId)
}

export function emptyReviewCoverage(): DocumentReviewCoverage {
  return { rules: null, references: null }
}

export function summarizeFindings(
  review: { reviewId: string; reviewedAt: Date; source?: string | null } | null,
  findings: ReadonlyArray<Pick<DocumentFinding, 'severity' | 'status' | 'anchorStatus'>>,
  playbook: DocumentReviewPlaybookInfo | null = null,
  coverage: DocumentReviewCoverage = emptyReviewCoverage(),
): DocumentFindingSummary {
  const open = emptySeverityCounts()
  const decided = { applied: 0, kept: 0 }
  let unlocated = 0
  for (const finding of findings) {
    if (finding.status === 'open') open[finding.severity] += 1
    if (finding.status === 'applied') decided.applied += 1
    if (finding.status === 'kept') decided.kept += 1
    if (finding.status !== 'superseded' && finding.anchorStatus === 'unlocated') unlocated += 1
  }
  return {
    reviewId: review?.reviewId ?? null,
    reviewedAt: review ? review.reviewedAt.toISOString() : null,
    source: review?.source ?? null,
    playbook,
    coverage,
    open,
    decided,
    unlocated,
  }
}

export async function loadDocumentFindingSummary(
  em: EntityManager,
  scope: DocumentFindingScope,
  documentId: string,
): Promise<DocumentFindingSummary> {
  const review = await resolveLatestReview(em, scope, documentId)
  if (!review) return summarizeFindings(null, [])
  const findings = await findWithDecryption(
    em,
    DocumentFinding,
    {
      documentId,
      reviewId: review.reviewId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    { fields: ['id', 'severity', 'status', 'anchorStatus'], limit: DOCUMENT_FINDING_SUMMARY_SCAN_LIMIT },
    scope,
  )
  const playbook = await loadReviewPlaybookInfo(em, scope, documentId, review.reviewId)
  const coverage = playbook ? await loadReviewCoverage(em, scope, playbook) : emptyReviewCoverage()
  return summarizeFindings(review, findings, playbook, coverage)
}

export function isPlaybookCoverageCurrent(reviewVersion: number | null, currentVersion: number | null | undefined): boolean {
  return reviewVersion !== null && currentVersion !== null && currentVersion !== undefined && reviewVersion === currentVersion
}

/**
 * Counts the active rules and guidance documents of the review's playbook,
 * only while the playbook is still at the version the review used.
 */
export async function loadReviewCoverage(
  em: EntityManager,
  scope: DocumentFindingScope,
  playbook: DocumentReviewPlaybookInfo,
): Promise<DocumentReviewCoverage> {
  const current = await findOneWithDecryption(
    em,
    DocumentReviewPlaybook,
    { id: playbook.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { fields: ['id', 'version'] },
    scope,
  )
  if (!isPlaybookCoverageCurrent(playbook.version, current?.version)) return emptyReviewCoverage()
  const where = { playbookId: playbook.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }
  const rules = await em.count(DocumentReviewRule, { ...where, isActive: true })
  const references = await em.count(DocumentReviewPlaybookReference, where)
  return { rules, references }
}

/**
 * Playbook snapshot of one review: the current playbook code and name with
 * the version the findings were produced against. A soft-deleted playbook
 * still labels the reviews it produced.
 */
export async function loadReviewPlaybookInfo(
  em: EntityManager,
  scope: DocumentFindingScope,
  documentId: string,
  reviewId: string,
): Promise<DocumentReviewPlaybookInfo | null> {
  const linked = await findOneWithDecryption(
    em,
    DocumentFinding,
    {
      documentId,
      reviewId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      playbookId: { $ne: null },
    },
    { fields: ['id', 'playbookId', 'playbookVersion'] },
    scope,
  )
  if (!linked?.playbookId) return null
  const playbook = await findOneWithDecryption(
    em,
    DocumentReviewPlaybook,
    { id: linked.playbookId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { fields: ['id', 'code', 'name'], filters: false },
    scope,
  )
  if (!playbook) return null
  return {
    id: playbook.id,
    code: playbook.code,
    name: playbook.name,
    version: linked.playbookVersion ?? null,
  }
}
