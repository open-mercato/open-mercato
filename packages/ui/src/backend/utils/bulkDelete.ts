"use client"

import { emitProgressUpdate } from '@open-mercato/shared/lib/frontend/progressEvents'

export type BulkDeleteFailure = {
  id: string
  code: string | null
  message: string
}

export type BulkDeleteOutcome<T extends { id: string }> = {
  succeeded: T[]
  failures: BulkDeleteFailure[]
}

export type BulkDeleteOptions = {
  fallbackErrorMessage?: string
  logTag?: string
  progress?: {
    jobId?: string
    jobType: string
    name: string
    description?: string | null
    meta?: Record<string, unknown> | null
  }
}

function createClientProgressJobId(jobType: string): string {
  const cryptoRef =
    typeof globalThis !== 'undefined'
      ? (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
      : undefined
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return `client:${cryptoRef.randomUUID()}`
  }
  return `client:${jobType}:${Date.now()}:${Math.random().toString(36).slice(2)}`
}

function calculateProgress(processed: number, total: number): number {
  if (total <= 0) return 100
  return Math.max(0, Math.min(100, Math.round((processed / total) * 100)))
}

function calculateEtaSeconds(startedAtMs: number, processed: number, total: number): number | null {
  if (processed <= 0 || processed >= total) return null
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAtMs) / 1000))
  return Math.ceil((elapsedSeconds / processed) * (total - processed))
}

export async function runBulkDelete<T extends { id: string }>(
  rows: T[],
  deleteOne: (row: T) => Promise<void>,
  options?: BulkDeleteOptions,
): Promise<BulkDeleteOutcome<T>> {
  const fallback = options?.fallbackErrorMessage ?? 'Delete failed'
  const logTag = options?.logTag
  const succeeded: T[] = []
  const failures: BulkDeleteFailure[] = []
  const progress = options?.progress
  const progressJobId = progress && rows.length > 0 ? progress.jobId ?? createClientProgressJobId(progress.jobType) : null
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()
  if (progress && progressJobId) {
    emitProgressUpdate({
      jobId: progressJobId,
      jobType: progress.jobType,
      name: progress.name,
      description: progress.description ?? null,
      meta: progress.meta ?? null,
      status: 'running',
      progressPercent: 0,
      processedCount: 0,
      totalCount: rows.length,
      etaSeconds: null,
      cancellable: false,
      startedAt,
    })
  }
  for (const row of rows) {
    try {
      await deleteOne(row)
      succeeded.push(row)
    } catch (err) {
      const message =
        err instanceof Error && err.message.trim().length > 0 ? err.message : fallback
      const rawCode =
        err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined
      const code = typeof rawCode === 'string' && rawCode.length > 0 ? rawCode : null
      failures.push({ id: row.id, code, message })
      if (logTag && typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(`[${logTag}] bulk delete failed`, { id: row.id, code, message, err })
      }
    }
    if (progress && progressJobId) {
      const processed = succeeded.length + failures.length
      emitProgressUpdate({
        jobId: progressJobId,
        jobType: progress.jobType,
        name: progress.name,
        description: progress.description ?? null,
        meta: progress.meta ?? null,
        status: 'running',
        progressPercent: calculateProgress(processed, rows.length),
        processedCount: processed,
        totalCount: rows.length,
        etaSeconds: calculateEtaSeconds(startedAtMs, processed, rows.length),
        cancellable: false,
        startedAt,
      })
    }
  }
  if (progress && progressJobId) {
    emitProgressUpdate({
      jobId: progressJobId,
      jobType: progress.jobType,
      name: progress.name,
      description: progress.description ?? null,
      meta: {
        ...(progress.meta ?? {}),
        succeededCount: succeeded.length,
        failedCount: failures.length,
      },
      status: failures.length === rows.length && rows.length > 0 ? 'failed' : 'completed',
      progressPercent: 100,
      processedCount: rows.length,
      totalCount: rows.length,
      etaSeconds: 0,
      cancellable: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      errorMessage:
        failures.length === rows.length && failures[0]?.message
          ? failures[0].message
          : null,
    })
  }
  return { succeeded, failures }
}

export type BulkDeleteFailureGroup = {
  key: string
  count: number
  sampleMessage: string
  ids: string[]
}

// Keyed by `code` when present so semantically identical failures collapse into
// one toast even if their message text varies (e.g. row-specific dependency
// counts). Falls back to the raw message when the server did not surface a code.
export function groupBulkDeleteFailures(
  failures: BulkDeleteFailure[],
): BulkDeleteFailureGroup[] {
  const buckets = new Map<string, BulkDeleteFailureGroup>()
  for (const failure of failures) {
    const key = failure.code || failure.message || 'unknown'
    const existing = buckets.get(key)
    if (existing) {
      existing.count += 1
      existing.ids.push(failure.id)
      continue
    }
    buckets.set(key, {
      key,
      count: 1,
      sampleMessage: failure.message,
      ids: [failure.id],
    })
  }
  return Array.from(buckets.values())
}
