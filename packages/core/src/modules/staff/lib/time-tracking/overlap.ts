/**
 * EP-38 — the overlap policy provider.
 *
 * `findOverlaps` is unchanged: it still answers the arithmetic question "which
 * of these spans intersect the candidate". What is new is the policy layer on
 * top of it, which answers the product question "and what should happen".
 *
 * The built-in `staff.time_tracking.overlap.warn_when_enabled` reproduces
 * today's behaviour exactly, including the setting's off state: overlapping time
 * is legitimate in consulting work, so the answer is `warn` when the
 * `warnings.overlap` tenant setting is on and at least one span intersects, and
 * `allow` otherwise. It never returns `block`.
 *
 * Contributed policies can only ESCALATE — the combined answer is the most
 * severe of every policy's, `block` > `warn` > `allow` — so a payroll-compliance
 * module can harden the rule but nothing can silently suppress a warning the
 * tenant asked for.
 */

import { MINUTES_PER_DAY, deriveInterval, parseClock } from './interval'
import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { createStrategyRegistry, BUILT_IN_STRATEGY_PRIORITY } from './registries/registry'
import { hasResolverScope, type ScopedResolverContext } from './registries/scope'

export type OverlapSpan = {
  id?: string | null
  date: string
  start?: string | null
  end?: string | null
  durationMinutes?: number | null
}

export type Overlap = {
  id: string | null
  entry: OverlapSpan
  overlapMinutes: number
}

export type FindOverlapsOptions = {
  excludeId?: string
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

const MS_PER_DAY = 86400000

function toEpochDay(date: string | null | undefined): number | null {
  if (typeof date !== 'string') return null
  const match = DATE_ONLY_PATTERN.exec(date.trim())
  if (!match) return null
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (!Number.isFinite(utc)) return null
  return Math.round(utc / MS_PER_DAY)
}

function toAbsoluteSpan(span: OverlapSpan): { start: number; end: number } | null {
  const epochDay = toEpochDay(span?.date)
  if (epochDay === null) return null
  const derived = deriveInterval({
    start: span.start,
    end: span.end,
    durationMinutes: span.durationMinutes,
  })
  const startOfDay = parseClock(derived.start)
  if (startOfDay === null) return null
  const duration = derived.durationMinutes
  if (duration === null || duration <= 0) return null
  const start = epochDay * MINUTES_PER_DAY + startOfDay
  return { start, end: start + duration }
}

export function findOverlaps(
  candidate: OverlapSpan,
  existing: readonly OverlapSpan[],
  opts?: FindOverlapsOptions,
): Overlap[] {
  const candidateSpan = toAbsoluteSpan(candidate)
  if (!candidateSpan) return []

  const excludeId = opts?.excludeId
  const overlaps: Overlap[] = []

  for (const other of existing ?? []) {
    if (!other) continue
    if (excludeId !== undefined && other.id === excludeId) continue
    const otherSpan = toAbsoluteSpan(other)
    if (!otherSpan) continue
    if (candidateSpan.start >= otherSpan.end || otherSpan.start >= candidateSpan.end) continue
    overlaps.push({
      id: other.id ?? null,
      entry: other,
      overlapMinutes:
        Math.min(candidateSpan.end, otherSpan.end) - Math.max(candidateSpan.start, otherSpan.start),
    })
  }

  return overlaps
}

export type OverlapDecision = 'allow' | 'warn' | 'block'

export type OverlapPolicyContext = ScopedResolverContext & {
  candidate: OverlapSpan
  /** The tenant's `warnings.overlap` setting; the built-in reads only this. */
  warningsEnabled: boolean
  staffMemberId?: string | null
  timeProjectId?: string | null
  excludeId?: string | null
}

export type OverlapPolicy = {
  id: string
  priority?: number
  evaluate(spans: readonly Overlap[], ctx: OverlapPolicyContext): OverlapDecision
}

export const OVERLAP_POLICY_REGISTRY_ID = extensionPoints.hosts.overlapPolicyRegistry.spotId

export const BUILT_IN_OVERLAP_POLICY_ID = 'staff.time_tracking.overlap.warn_when_enabled'

const overlapRegistry = createStrategyRegistry<OverlapPolicy>(OVERLAP_POLICY_REGISTRY_ID)

export function registerOverlapPolicy(policy: OverlapPolicy): () => void {
  return overlapRegistry.register(policy)
}

export function listOverlapPolicies(): OverlapPolicy[] {
  return overlapRegistry.list()
}

export function getOverlapPolicy(id: string | null | undefined): OverlapPolicy | null {
  return overlapRegistry.get(id)
}

registerOverlapPolicy({
  id: BUILT_IN_OVERLAP_POLICY_ID,
  priority: BUILT_IN_STRATEGY_PRIORITY,
  evaluate: (spans, ctx) => (ctx.warningsEnabled && spans.length > 0 ? 'warn' : 'allow'),
})

const DECISION_SEVERITY: Record<OverlapDecision, number> = { allow: 0, warn: 1, block: 2 }

export function evaluateOverlapPolicies(
  spans: readonly Overlap[],
  ctx: OverlapPolicyContext,
): OverlapDecision {
  const scoped = hasResolverScope(ctx)
  let decision: OverlapDecision = 'allow'
  for (const policy of overlapRegistry.list()) {
    if (!scoped && policy.id !== BUILT_IN_OVERLAP_POLICY_ID) continue
    const answer = policy.evaluate(spans, ctx)
    if (DECISION_SEVERITY[answer] > DECISION_SEVERITY[decision]) decision = answer
  }
  return decision
}
