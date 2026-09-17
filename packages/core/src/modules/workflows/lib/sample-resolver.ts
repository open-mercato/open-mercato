/**
 * Workflows Module - per-step sample resolution (spec
 * 2026-07-26-workflows-ux-redesign.md section 3.6).
 *
 * Pure, dependency-free precedence chain for the context sample shown next to
 * a step in the editor and used to seed Test-step runs:
 *
 *   1. explicit pin — `metadata.editor.samples[stepId]` written by the user
 *   2. in-memory test output — the last Test-step result for the step
 *   3. ledger-derived placeholder — synthesized from the step's ledger
 *      entries so the preview always has an honest, typed shape
 *
 * Returns null when none of the three sources can produce anything. No React,
 * no ORM, no DI — loadable from the browser bundle and server routes alike.
 */

export type ResolvedSampleSource = 'pin' | 'test' | 'placeholder'

export interface ResolvedStepSample {
  data: unknown
  source: ResolvedSampleSource
}

export interface PinnedSampleEnvelope {
  pinnedAt: string
  source: 'manual' | 'test'
  data: unknown
}

export interface SampleLedgerEntry {
  path: string
  type: string
  options?: string[]
}

export interface ResolveStepSampleInput {
  stepId: string
  samples?: Record<string, PinnedSampleEnvelope> | null
  testOutputs?: Record<string, unknown> | null
  ledgerEntries?: SampleLedgerEntry[] | null
}

const PLACEHOLDER_DATE_SAMPLE = '2026-01-01T00:00:00.000Z'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function placeholderValueFor(entry: SampleLedgerEntry): unknown {
  switch (entry.type) {
    case 'text':
      return 'text'
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'date':
      return PLACEHOLDER_DATE_SAMPLE
    case 'select':
      return entry.options && entry.options.length > 0 ? entry.options[0] : 'option'
    case 'object':
      return {}
    default:
      return null
  }
}

function assignAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.').filter((segment) => segment.length > 0)
  if (segments.length === 0) return
  let cursor = target
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment]
    if (isPlainObject(existing)) {
      cursor = existing
    } else {
      const created: Record<string, unknown> = {}
      cursor[segment] = created
      cursor = created
    }
  }
  const leaf = segments[segments.length - 1]
  const current = cursor[leaf]
  if (isPlainObject(current) && isPlainObject(value)) return
  cursor[leaf] = value
}

export function buildPlaceholderFromLedger(entries: SampleLedgerEntry[]): Record<string, unknown> {
  const placeholder: Record<string, unknown> = {}
  for (const entry of entries) {
    assignAtPath(placeholder, entry.path, placeholderValueFor(entry))
  }
  return placeholder
}

export function resolveStepSample({
  stepId,
  samples,
  testOutputs,
  ledgerEntries,
}: ResolveStepSampleInput): ResolvedStepSample | null {
  const pinned = samples ? samples[stepId] : undefined
  if (pinned !== undefined) {
    return { data: pinned.data, source: 'pin' }
  }
  if (testOutputs && Object.prototype.hasOwnProperty.call(testOutputs, stepId)) {
    return { data: testOutputs[stepId], source: 'test' }
  }
  if (ledgerEntries && ledgerEntries.length > 0) {
    return { data: buildPlaceholderFromLedger(ledgerEntries), source: 'placeholder' }
  }
  return null
}
