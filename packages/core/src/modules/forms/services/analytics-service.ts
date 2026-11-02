/**
 * Phase 3 Track B — Form analytics.
 *
 * Computes AGGREGATE, PII-safe metrics across every version of a form's
 * submissions. The service is the only place that decrypts revision payloads,
 * and it does so exclusively to TALLY enumerable answers — it never returns a
 * decrypted value. The response carries counts only.
 *
 * PII-safety invariants (R-3-2 / R-3-5 mitigations):
 *  - Every read is scoped by `organizationId` + `tenantId`.
 *  - Per-field value distributions are emitted ONLY for non-sensitive,
 *    enumerable field types (`select_one`, `select_many`, `boolean`, `scale`).
 *  - Any field flagged `x-om-sensitive: true` is excluded from value
 *    distributions entirely — only its answered/blank counts are reported.
 *  - Free-text / non-enumerable fields never contribute raw values — only
 *    answered/blank counts.
 *  - Decryption happens server-side to count; decrypted values never leave
 *    this service and are never logged.
 *  - Aggregates are per-form / per-window — never broken down by subject.
 *
 * Cost control: the scan is capped at the most-recent N submissions
 * (`limit`, default 1000, max 5000). The cap and whether it was hit are echoed
 * in the response so callers can surface a "partial" indicator.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import {
  FormSubmission,
  FormSubmissionRevision,
  FormVersion,
  type FormSubmissionStatus,
} from '../data/entities'
import type { EncryptionService } from './encryption-service'
import type { FormVersionCompiler, FieldDescriptor } from './form-version-compiler'
import { resolveSectionViews } from './form-version-compiler'

export const ENUMERABLE_FIELD_TYPES = ['select_one', 'select_many', 'boolean', 'scale'] as const
export type EnumerableFieldType = (typeof ENUMERABLE_FIELD_TYPES)[number]

export const DEFAULT_ANALYTICS_SCAN_LIMIT = 1000
export const MAX_ANALYTICS_SCAN_LIMIT = 5000

type Scope = {
  organizationId: string
  tenantId: string
}

export type AnalyticsArgs = Scope & {
  formId: string
  /** Inclusive lower bound on `firstSavedAt`. */
  from?: Date | null
  /** Inclusive upper bound on `firstSavedAt`. */
  to?: Date | null
  /** Cap on the number of (most-recent) submissions scanned. */
  limit?: number | null
}

export type FunnelMetrics = {
  started: number
  submitted: number
  /** `submitted / started`, rounded to 4 decimals. `0` when nothing started. */
  completionRate: number
  byStatus: Record<FormSubmissionStatus | 'anonymized', number>
}

export type VolumePoint = {
  /** UTC day bucket, `YYYY-MM-DD`. */
  date: string
  started: number
  submitted: number
}

export type TimeToCompleteMetrics = {
  /** Number of submitted submissions with a measurable duration. */
  sampleSize: number
  /** Median seconds from `firstSavedAt` → `submittedAt`. `null` when no sample. */
  medianSeconds: number | null
  /** Average seconds from `firstSavedAt` → `submittedAt`. `null` when no sample. */
  averageSeconds: number | null
}

export type FieldChoiceCount = {
  /** Stringified option value chosen. */
  value: string
  count: number
}

export type FieldResponseStats = {
  fieldKey: string
  type: string
  sensitive: boolean
  /** Submissions whose current revision had a non-empty answer for this field. */
  answered: number
  /** Scanned submissions that left this field blank. */
  blank: number
  /**
   * Count distribution of chosen option values. Present ONLY for non-sensitive
   * enumerable types; `undefined` for free-text / sensitive / non-enumerable
   * fields (which only carry answered/blank counts).
   */
  choices?: FieldChoiceCount[]
}

export type DropOffPoint = {
  sectionKey: string
  /** Non-submitted drafts whose furthest-reached section is this one. */
  count: number
}

export type FormAnalytics = {
  formId: string
  window: { from: string | null; to: string | null }
  /** Whether the scan hit the cap (response may be partial). */
  scan: { limit: number; scanned: number; capped: boolean }
  funnel: FunnelMetrics
  volume: VolumePoint[]
  timeToComplete: TimeToCompleteMetrics
  fields: FieldResponseStats[]
  dropOff: DropOffPoint[]
}

export type AnalyticsServiceOptions = {
  emFactory: () => EntityManager
  compiler: FormVersionCompiler
  encryption: EncryptionService
}

const ALL_STATUSES: Array<FormSubmissionStatus> = ['draft', 'submitted', 'reopened', 'archived']

export class AnalyticsService {
  private readonly emFactory: () => EntityManager
  private readonly compiler: FormVersionCompiler
  private readonly encryption: EncryptionService

  constructor(options: AnalyticsServiceOptions) {
    this.emFactory = options.emFactory
    this.compiler = options.compiler
    this.encryption = options.encryption
  }

  async computeFormAnalytics(args: AnalyticsArgs): Promise<FormAnalytics> {
    const em = this.emFactory()
    const limit = clampLimit(args.limit)

    const versions = await em.find(FormVersion, {
      formId: args.formId,
      organizationId: args.organizationId,
      tenantId: args.tenantId,
    })

    if (versions.length === 0) {
      return emptyAnalytics(args, limit)
    }

    const versionById = new Map<string, FormVersion>()
    for (const version of versions) versionById.set(version.id, version)
    const versionIds = versions.map((version) => version.id)

    const where: Record<string, unknown> = {
      organizationId: args.organizationId,
      tenantId: args.tenantId,
      deletedAt: null,
      formVersionId: { $in: versionIds },
    }
    const firstSavedAtFilter = buildRangeFilter(args.from ?? null, args.to ?? null)
    if (firstSavedAtFilter) where.firstSavedAt = firstSavedAtFilter

    const submissions = await em.find(FormSubmission, where as never, {
      orderBy: { firstSavedAt: 'desc' },
      limit,
    })
    const capped = submissions.length >= limit

    const funnel = buildFunnel(submissions)
    const volume = buildVolume(submissions)
    const timeToComplete = buildTimeToComplete(submissions)

    const compiledByVersion = new Map<string, ReturnType<FormVersionCompiler['compile']>>()
    const sectionsByVersion = new Map<string, ReturnType<typeof resolveSectionViews>>()
    for (const version of versions) {
      const compiled = this.compiler.compile({
        id: version.id,
        updatedAt: version.updatedAt,
        schema: version.schema,
        uiSchema: version.uiSchema,
      })
      compiledByVersion.set(version.id, compiled)
      sectionsByVersion.set(version.id, resolveSectionViews(version.schema))
    }

    const fieldAccumulator = new FieldStatsAccumulator()
    const dropOffAccumulator = new Map<string, number>()

    for (const submission of submissions) {
      const compiled = compiledByVersion.get(submission.formVersionId)
      if (!compiled) continue
      const revision = submission.currentRevisionId
        ? await em.findOne(FormSubmissionRevision, {
            id: submission.currentRevisionId,
            submissionId: submission.id,
            organizationId: args.organizationId,
          })
        : null
      const decoded = revision ? await this.decodeRevision(args.organizationId, revision) : {}

      fieldAccumulator.tally(compiled.fieldIndex, decoded)

      const isDraft = submission.status === 'draft' || submission.status === 'reopened'
      if (isDraft) {
        const sections = sectionsByVersion.get(submission.formVersionId) ?? []
        const reached = furthestSectionReached(sections, compiled.fieldIndex, decoded)
        if (reached) dropOffAccumulator.set(reached, (dropOffAccumulator.get(reached) ?? 0) + 1)
      }
    }

    const dropOff: DropOffPoint[] = Array.from(dropOffAccumulator.entries())
      .map(([sectionKey, count]) => ({ sectionKey, count }))
      .sort((a, b) => b.count - a.count)

    return {
      formId: args.formId,
      window: {
        from: args.from ? args.from.toISOString() : null,
        to: args.to ? args.to.toISOString() : null,
      },
      scan: { limit, scanned: submissions.length, capped },
      funnel,
      volume,
      timeToComplete,
      fields: fieldAccumulator.toStats(),
      dropOff,
    }
  }

  private async decodeRevision(
    organizationId: string,
    revision: FormSubmissionRevision,
  ): Promise<Record<string, unknown>> {
    const ciphertext = ensureBuffer(revision.data)
    if (ciphertext.length === 0) return {}
    const plain = await this.encryption.decrypt(organizationId, ciphertext)
    if (plain.length === 0) return {}
    try {
      const parsed = JSON.parse(plain.toString('utf8'))
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
}

// ============================================================================
// Field stats accumulator
// ============================================================================

type FieldAccumulatorEntry = {
  type: string
  sensitive: boolean
  enumerable: boolean
  answered: number
  blank: number
  choices: Map<string, number>
}

class FieldStatsAccumulator {
  private readonly entries = new Map<string, FieldAccumulatorEntry>()

  tally(fieldIndex: Record<string, FieldDescriptor>, decoded: Record<string, unknown>): void {
    for (const descriptor of Object.values(fieldIndex)) {
      if (descriptor.type === 'info_block') continue
      const entry = this.ensure(descriptor)
      const value = decoded[descriptor.key]
      if (isBlank(value)) {
        entry.blank += 1
        continue
      }
      entry.answered += 1
      // Only non-sensitive enumerable fields contribute a value distribution.
      if (!entry.enumerable || entry.sensitive) continue
      for (const token of enumerableTokens(value)) {
        entry.choices.set(token, (entry.choices.get(token) ?? 0) + 1)
      }
    }
  }

  private ensure(descriptor: FieldDescriptor): FieldAccumulatorEntry {
    const existing = this.entries.get(descriptor.key)
    if (existing) return existing
    const entry: FieldAccumulatorEntry = {
      type: descriptor.type,
      sensitive: descriptor.sensitive,
      enumerable: (ENUMERABLE_FIELD_TYPES as readonly string[]).includes(descriptor.type),
      answered: 0,
      blank: 0,
      choices: new Map(),
    }
    this.entries.set(descriptor.key, entry)
    return entry
  }

  toStats(): FieldResponseStats[] {
    const stats: FieldResponseStats[] = []
    for (const [fieldKey, entry] of this.entries.entries()) {
      const stat: FieldResponseStats = {
        fieldKey,
        type: entry.type,
        sensitive: entry.sensitive,
        answered: entry.answered,
        blank: entry.blank,
      }
      if (entry.enumerable && !entry.sensitive) {
        stat.choices = Array.from(entry.choices.entries())
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count)
      }
      stats.push(stat)
    }
    return stats
  }
}

// ============================================================================
// Pure metric builders
// ============================================================================

export function buildFunnel(submissions: ReadonlyArray<FormSubmission>): FunnelMetrics {
  const byStatus: Record<FormSubmissionStatus | 'anonymized', number> = {
    draft: 0,
    submitted: 0,
    reopened: 0,
    archived: 0,
    anonymized: 0,
  }
  let started = 0
  let submitted = 0
  for (const submission of submissions) {
    started += 1
    if (submission.anonymizedAt) byStatus.anonymized += 1
    const status = submission.status as FormSubmissionStatus
    if (ALL_STATUSES.includes(status)) byStatus[status] += 1
    if (submission.submittedAt) submitted += 1
  }
  const completionRate = started > 0 ? roundTo(submitted / started, 4) : 0
  return { started, submitted, completionRate, byStatus }
}

export function buildVolume(submissions: ReadonlyArray<FormSubmission>): VolumePoint[] {
  const buckets = new Map<string, { started: number; submitted: number }>()
  for (const submission of submissions) {
    const startKey = dayKey(submission.firstSavedAt)
    if (startKey) {
      const bucket = buckets.get(startKey) ?? { started: 0, submitted: 0 }
      bucket.started += 1
      buckets.set(startKey, bucket)
    }
    if (submission.submittedAt) {
      const submitKey = dayKey(submission.submittedAt)
      if (submitKey) {
        const bucket = buckets.get(submitKey) ?? { started: 0, submitted: 0 }
        bucket.submitted += 1
        buckets.set(submitKey, bucket)
      }
    }
  }
  return Array.from(buckets.entries())
    .map(([date, value]) => ({ date, started: value.started, submitted: value.submitted }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function buildTimeToComplete(
  submissions: ReadonlyArray<FormSubmission>,
): TimeToCompleteMetrics {
  const durations: number[] = []
  for (const submission of submissions) {
    if (!submission.submittedAt || !submission.firstSavedAt) continue
    const seconds = (submission.submittedAt.getTime() - submission.firstSavedAt.getTime()) / 1000
    if (Number.isFinite(seconds) && seconds >= 0) durations.push(seconds)
  }
  if (durations.length === 0) {
    return { sampleSize: 0, medianSeconds: null, averageSeconds: null }
  }
  const sorted = [...durations].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, value) => acc + value, 0)
  return {
    sampleSize: sorted.length,
    medianSeconds: roundTo(median(sorted), 2),
    averageSeconds: roundTo(sum / sorted.length, 2),
  }
}

/**
 * Best-effort drop-off: the furthest section a draft reached, derived from
 * which fields carry a non-blank answer. Returns the last section (in
 * declaration order) that has at least one answered field, or `null` when no
 * answered field maps to a section.
 */
export function furthestSectionReached(
  sections: ReadonlyArray<{ key: string; fieldKeys: string[] }>,
  fieldIndex: Record<string, FieldDescriptor>,
  decoded: Record<string, unknown>,
): string | null {
  let reached: string | null = null
  for (const section of sections) {
    const hasAnswer = section.fieldKeys.some((fieldKey) => {
      if (!fieldIndex[fieldKey]) return false
      return !isBlank(decoded[fieldKey])
    })
    if (hasAnswer) reached = section.key
  }
  return reached
}

// ============================================================================
// Helpers
// ============================================================================

function emptyAnalytics(args: AnalyticsArgs, limit: number): FormAnalytics {
  return {
    formId: args.formId,
    window: {
      from: args.from ? args.from.toISOString() : null,
      to: args.to ? args.to.toISOString() : null,
    },
    scan: { limit, scanned: 0, capped: false },
    funnel: {
      started: 0,
      submitted: 0,
      completionRate: 0,
      byStatus: { draft: 0, submitted: 0, reopened: 0, archived: 0, anonymized: 0 },
    },
    volume: [],
    timeToComplete: { sampleSize: 0, medianSeconds: null, averageSeconds: null },
    fields: [],
    dropOff: [],
  }
}

function clampLimit(limit: number | null | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_ANALYTICS_SCAN_LIMIT
  }
  return Math.min(Math.floor(limit), MAX_ANALYTICS_SCAN_LIMIT)
}

function buildRangeFilter(from: Date | null, to: Date | null): Record<string, Date> | null {
  const filter: Record<string, Date> = {}
  if (from) filter.$gte = from
  if (to) filter.$lte = to
  return Object.keys(filter).length > 0 ? filter : null
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function enumerableTokens(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry !== null && entry !== undefined)
      .map((entry) => stringifyToken(entry))
  }
  return [stringifyToken(value)]
}

function stringifyToken(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function dayKey(date: Date): string | null {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function median(sorted: ReadonlyArray<number>): number {
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2
  return sorted[mid]
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function ensureBuffer(value: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'string') return Buffer.from(value, 'binary')
  return Buffer.alloc(0)
}
