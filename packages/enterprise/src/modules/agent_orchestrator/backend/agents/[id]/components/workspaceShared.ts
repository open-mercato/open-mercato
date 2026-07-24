import type { StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { formatTimeShort } from '../../../../components/types'
import { subjectRefOf } from '../../../../components/subjectRef'

export type Autonomy = 'auto' | 'review' | 'gated'
export type Health = 'good' | 'watch' | 'poor' | 'new'
export type Outcome = 'overridden' | 'applied' | 'pending' | 'failed'
export type WorkspaceTab = 'overview' | 'activity' | 'evaluation' | 'configuration'

export type RunRow = {
  id: string
  claim: string
  decision: string
  confidence: number | null
  outcome: Outcome
  when: string | null
}

export type AgentMetrics = {
  overrideRate: number | null
  pending: number
  status: Health
  lastActive: string
  runCount: number
  errorCount: number
  recent: RunRow[]
}

export const statusVariant: StatusMap<Health> = { good: 'success', watch: 'warning', poor: 'error', new: 'neutral' }
export const outcomeVariant: Record<Outcome, 'success' | 'error' | 'neutral'> = {
  applied: 'success',
  overridden: 'error',
  failed: 'error',
  pending: 'neutral',
}

const DISPOSED = ['approved', 'edited', 'rejected', 'auto_approved']
const OVERRIDDEN = ['edited', 'rejected']

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function autonomyHintFallback(autonomy: Autonomy): string {
  if (autonomy === 'auto') return 'Runs autonomously and applies its output without human review.'
  if (autonomy === 'gated') return 'Every action is gated behind an explicit human approval.'
  return 'A human reviews every output before it is applied.'
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}
function fieldOf(item: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = asString(item[key])
    if (v) return v
  }
  return ''
}

/**
 * Joins run rows to their proposals and returns every run as a display row,
 * newest first. Shared by the header/Overview metrics and the Activity tab so
 * outcome derivation lives in exactly one place.
 */
export function buildRunRows(
  runs: Array<Record<string, unknown>>,
  proposals: Array<Record<string, unknown>>,
): RunRow[] {
  const proposalByRun = new Map<string, Record<string, unknown>>()
  for (const proposal of proposals) {
    const runId = fieldOf(proposal, 'run_id', 'runId')
    if (runId) proposalByRun.set(runId, proposal)
  }
  const sortedRuns = [...runs].sort(
    (a, b) =>
      Date.parse(fieldOf(b, 'created_at', 'createdAt') || '') - Date.parse(fieldOf(a, 'created_at', 'createdAt') || ''),
  )
  return sortedRuns.map((run) => {
    const runId = fieldOf(run, 'id')
    const input = asObject(run.input)
    const proposal = proposalByRun.get(runId)
    const payload = proposal ? asObject(proposal.payload) : null
    const disposition = proposal ? fieldOf(proposal, 'disposition') || 'pending' : 'pending'
    let outcome: Outcome = 'pending'
    if (run.status === 'error') outcome = 'failed'
    else if (OVERRIDDEN.includes(disposition)) outcome = 'overridden'
    else if (disposition === 'approved' || disposition === 'auto_approved') outcome = 'applied'
    return {
      id: runId,
      claim: (input && subjectRefOf(input)) || runId.slice(0, 12),
      decision:
        (payload && fieldOf(payload, 'decision', 'action', 'label')) || fieldOf(run, 'result_kind', 'resultKind') || '—',
      confidence: proposal ? asNumber(proposal.confidence) : null,
      outcome,
      when: fieldOf(run, 'created_at', 'createdAt') || null,
    }
  })
}

/**
 * Derives the agent's health, override rate, pending count and the six most
 * recent runs. Extracted from the pre-refactor single-scroll page so the header
 * and Overview tab share one computation.
 */
export function computeAgentMetrics(
  runs: Array<Record<string, unknown>>,
  proposals: Array<Record<string, unknown>>,
): AgentMetrics {
  let disposed = 0
  let overrides = 0
  let pending = 0
  for (const proposal of proposals) {
    const disposition = fieldOf(proposal, 'disposition') || 'pending'
    if (disposition === 'pending') pending += 1
    if (DISPOSED.includes(disposition)) disposed += 1
    if (OVERRIDDEN.includes(disposition)) overrides += 1
  }
  const overrideRate = disposed > 0 ? overrides / disposed : null
  const errorCount = runs.filter((run) => run.status === 'error').length
  const errorRate = runs.length > 0 ? errorCount / runs.length : 0
  let status: Health = 'new'
  if (runs.length > 0 || disposed > 0) {
    if ((overrideRate ?? 0) > 0.3 || errorRate > 0.2) status = 'poor'
    else if ((overrideRate ?? 0) > 0.15) status = 'watch'
    else status = 'good'
  }

  const rows = buildRunRows(runs, proposals)
  const lastActive = formatTimeShort(rows[0]?.when ?? null) ?? ''
  return { overrideRate, pending, status, lastActive, runCount: runs.length, errorCount, recent: rows.slice(0, 6) }
}

/**
 * Buckets runs into per-day counts for the Overview sparkline (oldest→newest).
 * Locale-neutral: uses day-resolution epoch buckets, not formatted dates.
 */
export function runVolumeByDay(runs: Array<Record<string, unknown>>, days: number, nowMs: number): number[] {
  const buckets = new Array<number>(days).fill(0)
  const dayMs = 86_400_000
  const todayStart = Math.floor(nowMs / dayMs)
  for (const run of runs) {
    const iso = fieldOf(run, 'created_at', 'createdAt')
    const parsed = iso ? Date.parse(iso) : NaN
    if (!Number.isFinite(parsed)) continue
    const dayIndex = Math.floor(parsed / dayMs)
    const offset = todayStart - dayIndex
    if (offset >= 0 && offset < days) buckets[days - 1 - offset] += 1
  }
  return buckets
}
