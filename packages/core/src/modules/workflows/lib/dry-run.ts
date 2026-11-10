/**
 * Workflows Module — Dry-run (spec section 8.2)
 *
 * A dry run is a REAL instance (`WorkflowInstance.isDryRun`) executed by the
 * ordinary engine loop with every effector replaced by its registry `mock`.
 * There is deliberately no second simulation path: a parallel interpreter would
 * drift from the engine and the report would stop being evidence about the
 * workflow that actually runs.
 *
 * This module is PURE — no ORM, no DI, no React — so the isolation rules and
 * the "Would do" report are unit-testable without a database.
 */

import type { WorkflowValidationIssueSeverity } from './collect-validation-issues'

/**
 * The subset of `WorkflowInstance` every isolation decision reads. Taking the
 * shape rather than the entity keeps this module free of the ORM import and
 * lets the engine pass a branch-scoped view where it has one.
 */
export type DryRunAwareInstance = {
  isDryRun?: boolean | null
}

export function isDryRunInstance(instance: DryRunAwareInstance | null | undefined): boolean {
  return instance?.isDryRun === true
}

/**
 * Raised when a dry run reaches an activity type that refuses simulation
 * (`mock: 'refuse'`) or declares no mock at all.
 *
 * Spec section 8.2: *"`mock: 'refuse'` types stop the dry-run at that node with
 * an explicit marker."* A refusal is NOT an activity failure — nothing was
 * attempted — so it must never be routed down the step's error route or
 * absorbed by its `errorDirective`. `isDryRunRefusal` is what the failure paths
 * check to keep that promise, and it is structural (a marker property) for the
 * same reason `isRetryableError` is: the check must survive an error crossing a
 * module boundary.
 */
export class WorkflowDryRunRefusalError extends Error {
  readonly dryRunRefused = true

  constructor(
    readonly activityType: string,
    readonly reason: DryRunRefusalReason,
    readonly activityName?: string,
  ) {
    super(`[internal] dry run cannot simulate activity type ${activityType} (${reason})`)
    this.name = 'WorkflowDryRunRefusalError'
  }
}

export type DryRunRefusalReason = 'refused' | 'noMock'

export function isDryRunRefusal(error: unknown): error is WorkflowDryRunRefusalError {
  if (!error || typeof error !== 'object') return false
  return (error as { dryRunRefused?: unknown }).dryRunRefused === true
}

// ============================================================================
// "Would do" report
// ============================================================================

/**
 * Event types a dry run writes in addition to the ordinary run log. They ride
 * the same `WorkflowEvent` table because the module's event-sourcing rule
 * already makes that the audit trail, and because the report then inherits the
 * run views' ordering, scoping and retention for free.
 */
export const DRY_RUN_EVENT_TYPES = {
  started: 'DRY_RUN_STARTED',
  activitySimulated: 'ACTIVITY_SIMULATED',
  activityRefused: 'ACTIVITY_SIMULATION_REFUSED',
  userTaskSimulated: 'USER_TASK_SIMULATED',
  businessRuleActionsSuppressed: 'BUSINESS_RULE_ACTIONS_SUPPRESSED',
} as const

export type DryRunEventType = typeof DRY_RUN_EVENT_TYPES[keyof typeof DRY_RUN_EVENT_TYPES]

export type WouldDoEntryKind =
  | 'activity'
  | 'refusal'
  | 'userTask'
  | 'businessRule'

export type WouldDoEntry = {
  id: string
  kind: WouldDoEntryKind
  /** `error` marks the refusal that stopped the run; everything else is informational. */
  severity: WorkflowValidationIssueSeverity | 'info'
  stepId: string | null
  occurredAt: string
  /** Machine label — `SEND_EMAIL`, `INVOKE_AGENT`, `USER_TASK`, a rule id. */
  subject: string
  detail: Record<string, unknown>
}

export type WouldDoSourceEvent = {
  id: string
  eventType: string
  stepId?: string | null
  occurredAt: string | Date
  eventData?: Record<string, unknown> | null
}

export type WouldDoReport = {
  entries: WouldDoEntry[]
  /** True once a refusal stopped the run — the report is then not the whole graph. */
  stoppedByRefusal: boolean
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

const asText = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value
}

function describeEvent(event: WouldDoSourceEvent): Omit<WouldDoEntry, 'id' | 'stepId' | 'occurredAt'> | null {
  const data = asRecord(event.eventData)
  switch (event.eventType) {
    case DRY_RUN_EVENT_TYPES.activitySimulated:
      return {
        kind: 'activity',
        severity: 'info',
        subject: asText(data.activityType, 'ACTIVITY'),
        detail: {
          activityName: data.activityName ?? null,
          output: data.output ?? null,
        },
      }
    case DRY_RUN_EVENT_TYPES.activityRefused:
      return {
        kind: 'refusal',
        severity: 'error',
        subject: asText(data.activityType, 'ACTIVITY'),
        detail: { reason: asText(data.reason, 'noMock') },
      }
    case DRY_RUN_EVENT_TYPES.userTaskSimulated:
      return {
        kind: 'userTask',
        severity: 'warning',
        subject: asText(data.taskName, 'USER_TASK'),
        detail: {
          assignedTo: data.assignedTo ?? null,
          assignedToRoles: data.assignedToRoles ?? null,
          decisions: data.decisions ?? [],
        },
      }
    case DRY_RUN_EVENT_TYPES.businessRuleActionsSuppressed:
      return {
        kind: 'businessRule',
        severity: 'warning',
        subject: asText(data.ruleId, 'BUSINESS_RULE'),
        detail: { phase: asText(data.phase, 'pre_transition') },
      }
    default:
      return null
  }
}

/**
 * Build the ordered "Would do" report from a run's events.
 *
 * Callers pass events in ANY order; the report sorts by `occurredAt` and falls
 * back to the caller's order for ties (an activity and its refusal can share a
 * millisecond), which is why the sort is explicit and stable rather than a bare
 * `.sort()`.
 */
export function buildWouldDoReport(events: WouldDoSourceEvent[]): WouldDoReport {
  const decorated: Array<{ entry: WouldDoEntry; index: number }> = []

  events.forEach((event, index) => {
    const described = describeEvent(event)
    if (!described) return
    decorated.push({
      index,
      entry: {
        ...described,
        id: event.id,
        stepId: event.stepId ?? null,
        occurredAt: toIsoString(event.occurredAt),
      },
    })
  })

  decorated.sort((left, right) => {
    if (left.entry.occurredAt !== right.entry.occurredAt) {
      return left.entry.occurredAt < right.entry.occurredAt ? -1 : 1
    }
    return left.index - right.index
  })

  const entries = decorated.map((item) => item.entry)
  return {
    entries,
    stoppedByRefusal: entries.some((entry) => entry.kind === 'refusal'),
  }
}
