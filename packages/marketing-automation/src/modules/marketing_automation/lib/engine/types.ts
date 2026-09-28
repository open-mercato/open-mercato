import type { ConditionExpression } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'

/**
 * One authored step. `params` stays opaque here and is validated by the step handler's own
 * zod schema, which is what lets another module contribute a step type without this file
 * knowing about it.
 */
export type CampaignStep = {
  id: string
  type: string
  params: Record<string, unknown>
}

/** Canvas layout, keyed by node id (a step id, `audience`, or `trigger:<eventId>`). */
export type CampaignCanvasLayout = {
  viewport?: { x: number; y: number; zoom: number }
  nodePositions?: Record<string, { x: number; y: number }>
}

/**
 * The authored campaign graph, stored as one jsonb column.
 *
 * `audience === null` means no filter — the campaign applies to every subject the trigger
 * produces. That is an explicit authoring choice, and the UI must render it as such rather
 * than as an empty box, because it is the difference between "nobody configured this yet"
 * and "send to everyone".
 */
export type CampaignDefinition = {
  version: 1
  audience: ConditionExpression | null
  steps: CampaignStep[]
  canvas?: CampaignCanvasLayout
  /**
   * Frequency cap and quiet hours. Kept inside the definition rather than in columns of their
   * own because they are authored on the same screen as the graph and saved in the same write —
   * splitting them out would buy a migration and two sources of truth for one save.
   */
  sendPolicy?: {
    frequencyCap?: { maxMessages: number; windowHours: number } | null
    quietHours?: { startHour: number; endHour: number } | null
  }
}

/**
 * What an audience expression is evaluated against.
 *
 * Projected once per subject per dispatch and memoized, so several conditions referencing
 * order aggregates cost one query, not one each. Field paths in the builder are exactly the
 * paths in this shape — `orders.daysSinceLast`, `tags`, `trigger.orderTotal`.
 */
export type SubjectDocument = {
  customer: {
    id: string
    email: string | null
    displayName: string | null
    createdAt: string | null
  } | null
  /** Tag slugs, so an audience can say `tags CONTAINS 'vip'`. */
  tags: string[]
  orders: {
    count: number
    totalGross: number
    /**
     * ABSENT — not null — when the subject has never ordered.
     *
     * This is load-bearing. The expression evaluator compares with JavaScript semantics, and
     * `null <= 30` coerces null to 0, so a null `daysSinceLast` would make somebody who never
     * bought anything satisfy "ordered in the last 30 days" and land in a win-back campaign.
     * An absent key resolves to undefined, every numeric comparison against it is false, and
     * the filter fails closed. Never reintroduce null here.
     */
    lastPlacedAt?: string
    daysSinceLast?: number
  }
  /** Scalars the triggering event contributed. */
  trigger: Record<string, unknown>
}

/**
 * Dispatch context, threaded through a run and persisted to jsonb when a wait parks it.
 * JSON-serializable throughout, so dates are ISO strings.
 */
export type AutomationContext = {
  tenantId: string
  organizationId: string
  eventId: string
  occurredAt: string
  /** Guards against a campaign whose step re-emits its own trigger event. */
  dispatchDepth: number
  subjectEntityId?: string | null
  campaignId?: string
  runId?: string
} & Record<string, unknown>

export type EngineLogger = {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

/** Outcome of one executed step, appended to the run's `stepLog`. */
export type StepOutcome = {
  stepId: string
  type: string
  status: 'done' | 'skipped' | 'failed'
  at: string
  detail?: string
}
