/**
 * One health vocabulary for the whole module.
 *
 * The overview said "Not checked" while the web-search settings page said "Not
 * tested" for the same fact, each with its own colour decision, in five locales.
 * Both surfaces now read their labels and variants from here.
 *
 * PURE — no React, so it can be imported by server code and unit-tested directly.
 */
import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { HealthState } from '../../lib/systemHealth'

export const HEALTH_STATE_VARIANT: Record<HealthState, StatusBadgeVariant> = {
  ok: 'success',
  degraded: 'warning',
  down: 'error',
  unknown: 'neutral',
  error: 'error',
}

export const HEALTH_STATE_LABEL_KEY: Record<HealthState, string> = {
  ok: 'agent_orchestrator.health.state.ok',
  degraded: 'agent_orchestrator.health.state.degraded',
  down: 'agent_orchestrator.health.state.down',
  unknown: 'agent_orchestrator.health.state.unknown',
  error: 'agent_orchestrator.health.state.error',
}

/** English defaults, so a missing key degrades to a word rather than to the key. */
export const HEALTH_STATE_FALLBACK: Record<HealthState, string> = {
  ok: 'Healthy',
  degraded: 'Degraded',
  down: 'Down',
  unknown: 'Not checked',
  error: 'Check failed',
}

/**
 * Compact age for a probe result. Units are symbols rather than words on purpose:
 * the row is a fixed-width column and `${latencyMs}ms` already sets that precedent.
 */
export function formatProbeAge(checkedAt: string | null | undefined, nowMs: number): string | null {
  if (!checkedAt) return null
  const then = Date.parse(checkedAt)
  if (Number.isNaN(then)) return null
  const seconds = Math.max(0, Math.round((nowMs - then) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}
