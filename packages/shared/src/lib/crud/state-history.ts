/**
 * Generic state transition recording for any stateful entity.
 * Useful for tracking pipeline stages, order statuses, approval workflows, etc.
 */

export type StateTransition = {
  entityType: string
  entityId: string
  fromState: { id: string; label: string; group?: string } | null
  toState: { id: string; label: string; group?: string }
  changedBy: string | null
  durationSeconds?: number | null
  metadata?: Record<string, unknown>
}

export type StateHistoryEntry = {
  id: string
  entityType: string
  entityId: string
  fromStateId: string | null
  fromStateLabel: string | null
  fromStateGroup: string | null
  toStateId: string
  toStateLabel: string
  toStateGroup: string | null
  changedByUserId: string | null
  durationSeconds: number | null
  metadata: Record<string, unknown> | null
  createdAt: Date | string
}

/**
 * Build a state history record from a transition.
 * The caller is responsible for persisting the record.
 */
export function buildStateHistoryRecord(
  transition: StateTransition,
): Omit<StateHistoryEntry, 'id' | 'createdAt'> {
  return {
    entityType: transition.entityType,
    entityId: transition.entityId,
    fromStateId: transition.fromState?.id ?? null,
    fromStateLabel: transition.fromState?.label ?? null,
    fromStateGroup: transition.fromState?.group ?? null,
    toStateId: transition.toState.id,
    toStateLabel: transition.toState.label,
    toStateGroup: transition.toState.group ?? null,
    changedByUserId: transition.changedBy,
    durationSeconds: transition.durationSeconds ?? null,
    metadata: transition.metadata ?? null,
  }
}

/**
 * Compute duration in seconds between two timestamps.
 */
export function computeTransitionDuration(
  from: Date | string | null,
  to: Date | string | null = new Date(),
): number | null {
  if (!from || !to) return null
  const fromMs = new Date(from).getTime()
  const toMs = new Date(to).getTime()
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null
  return Math.max(0, Math.round((toMs - fromMs) / 1000))
}
