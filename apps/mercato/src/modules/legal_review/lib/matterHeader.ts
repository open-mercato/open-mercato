import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import { legalMatterItemSchema, type LegalMatterItem, type LegalMatterStage } from '../data/validators'

/** Findings summary the documents page passes into the header spot (may be null). */
export type DocumentFindingsSummaryContext = {
  reviewId: string | null
  reviewedAt: string | null
  open: { blocking: number; warning: number; info: number }
  decided: { applied: number; kept: number }
  unlocated: number
}

export type LegalMatterHeaderContext = {
  documentId?: string | null
  document?: unknown
  summary?: DocumentFindingsSummaryContext | null
}

export function readDocumentIdFromContext(context: unknown): string | null {
  if (!context || typeof context !== 'object') return null
  const record = context as Record<string, unknown>
  const direct = record.documentId
  if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim()
  const document = record.document
  if (document && typeof document === 'object') {
    const nested = (document as Record<string, unknown>).id
    if (typeof nested === 'string' && nested.trim().length > 0) return nested.trim()
  }
  return null
}

/** First valid matter from a `GET /api/legal_review/matters` response, or null. */
export function pickMatterFromListResponse(body: unknown): LegalMatterItem | null {
  if (!body || typeof body !== 'object') return null
  const items = (body as { items?: unknown }).items
  if (!Array.isArray(items)) return null
  for (const item of items) {
    const parsed = legalMatterItemSchema.safeParse(item)
    if (parsed.success) return parsed.data
  }
  return null
}

export function buildMatterListPath(documentId: string): string {
  const params = new URLSearchParams({ documentId, pageSize: '1', sortField: 'createdAt', sortDir: 'desc' })
  return `/api/legal_review/matters?${params.toString()}`
}

export function formatDueRelative(dueAt: string | null, locale?: string): string | null {
  return formatRelativeTime(dueAt, locale ? { locale } : undefined)
}

/** One-line status shown under the stage tracker for the current stage. */
export function buildStageStatusLine(
  matter: Pick<LegalMatterItem, 'stage' | 'assigneeLabel' | 'requestedByLabel' | 'dueAt'>,
  t: TranslateFn,
  locale?: string,
): string {
  const assignee = matter.assigneeLabel ?? t('legal_review.header.unassigned', 'Unassigned')
  const requester = matter.requestedByLabel ?? t('legal_review.header.requester', 'the requester')
  const lines: Record<LegalMatterStage, string> = {
    requested: t('legal_review.header.status.requested', 'Waiting for {assignee}', { assignee }),
    review: t('legal_review.header.status.review', '{assignee} is reviewing', { assignee }),
    released: t('legal_review.header.status.released', 'Released to {requester}', { requester }),
    signing: t('legal_review.header.status.signing', 'Out for signature'),
  }
  const base = lines[matter.stage]
  const beforeRelease = matter.stage === 'requested' || matter.stage === 'review'
  const relative = beforeRelease ? formatDueRelative(matter.dueAt, locale) : null
  if (!relative) return base
  return t('legal_review.header.status.withDue', '{status} · due {relative}', { status: base, relative })
}

/** Region display name for an ISO country code ("US" → "United States"); falls back to the code. */
export function formatJurisdiction(code: string | null, locale?: string): string | null {
  if (!code) return null
  try {
    const names = new Intl.DisplayNames(locale ? [locale] : undefined, { type: 'region' })
    return names.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

/** True when a matter still before release is past its due date. */
export function isMatterOverdue(
  matter: Pick<LegalMatterItem, 'stage' | 'dueAt'>,
  now: number = Date.now(),
): boolean {
  if (matter.stage !== 'requested' && matter.stage !== 'review') return false
  if (!matter.dueAt) return false
  const due = new Date(matter.dueAt).getTime()
  return !Number.isNaN(due) && due < now
}
