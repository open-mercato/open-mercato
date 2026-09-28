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
    optimizeSendTime?: boolean
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
    /**
     * Distinct product SKUs this customer has bought, newest first and capped.
     *
     * Read from each order line's catalogue snapshot rather than from the catalogue, so a product that
     * was renamed — or deleted — still targets correctly: what matters is what the customer bought, and
     * the snapshot is the only record of that.
     */
    skus: string[]
  }
  /**
   * Lead score, summed from the score ledger.
   *
   * Zero for a customer who has never scored, and zero is MEANINGFUL here — unlike
   * `orders.daysSinceLast`, which is absent rather than null precisely because "no data" and "zero"
   * are different facts for a date and the same fact for a points total.
   */
  score: {
    points: number
    /**
     * The tier key, or null below every configured bound. Compared with `=` or `IN`.
     */
    tier: string | null
    /**
     * Position in the ladder, so "at least silver" is `score.tierRank >= 1`. -1 below every bound,
     * which keeps every `>=` comparison false rather than accidentally true for the unranked.
     */
    tierRank: number
  }
  /**
   * Where the customer is, from their address.
   *
   * Null when they have none. Every field here is ENCRYPTED at rest, which has one consequence worth
   * stating: a geographic audience cannot be narrowed in the database, so a campaign targeting a country
   * is evaluated per customer. Correct, and more expensive than the other predicates.
   */
  address: {
    country: string | null
    region: string | null
    city: string | null
    postalCode: string | null
  } | null
  /** Scalars the triggering event contributed. */
  trigger: Record<string, unknown>
}

/**
 * Dispatch context, threaded through a run and persisted to jsonb when a wait parks it.
 * JSON-serializable throughout, so dates are ISO strings.
 *
 * MUST NOT carry decrypted PII. It is written to `marketing_campaign_runs.context`, which the
 * platform's at-rest encryption does not cover, so an email or a name placed here becomes an
 * unencrypted copy of a field the rest of the system protects. Resolve such values where they are
 * used, through the decrypting finders.
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
  /**
   * The id of the step currently executing.
   *
   * Passed by the executor and typed here because a step legitimately needs its own identity —
   * tracking tokens key on (run, step), which is what makes one message's opens distinguishable
   * from another's in the same journey.
   */
  actionId?: string
  /**
   * The one-click unsubscribe URL for the message being rendered.
   *
   * Present only while a message is being composed, so an author can place `{{unsubscribeUrl}}` where
   * their design wants it. Absent everywhere else, including in a run's persisted context — it is derived
   * from the run and does not need storing.
   */
  unsubscribeUrl?: string
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
