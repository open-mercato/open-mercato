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
    sendHour?: number | null
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
    /**
     * The language the customer chose for themselves, or null.
     *
     * An audience targets it as `customer.locale`, which is how per-language campaigns are authored: one
     * campaign (or one split lane) per language, each with copy already written in it. Null is not a
     * language — a guess from an address is how somebody gets marketing they cannot read.
     */
    locale: string | null
  } | null
  /** Tag slugs, so an audience can say `tags CONTAINS 'vip'`. */
  tags: string[]
  /**
   * ABSENT when this installation has no `sales` module.
   *
   * `sales` is declared in `optionalRequires`, so its tables may genuinely not exist — and the key is omitted
   * rather than zeroed, which is the difference between a campaign that mails nobody and one that mails
   * everybody. `orders.count: 0` is a TRUE statement about a never-buyer and a LIE about an installation with
   * no order data, and the lie satisfies `orders.count <= 5`, so a win-back audience would match the entire
   * customer base on a shop that cannot even record a sale.
   *
   * Omitting the parent rather than each field: "there is no order data here" is one fact and belongs in one
   * place. `getNestedValue` returns undefined as soon as a level is missing, so every `orders.*` path fails
   * closed through exactly the veto a never-buyer already relies on.
   */
  orders?: {
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
    /**
     * Category SLUGS of the products this customer has bought, capped.
     *
     * Read from the catalogue rather than the order snapshot, unlike `skus` — a category is a current
     * classification and re-filing a product should change who is targeted, while a sku is a historical fact
     * about the purchase. `lib/subject-document.ts` states the trade-off in full.
     */
    categories: string[]
    /**
     * Sales channel CODES this customer has bought through.
     *
     * The platform has no "belongs to this store" field on a customer, so channel targeting means "has bought
     * in this channel" — derivable from orders rather than a second place for the same fact to be wrong.
     */
    channels: string[]
    /**
     * ISO date of the FIRST order, absent for a never-buyer.
     *
     * Present so a value projection can measure the customer's cadence over the whole time they have been
     * buying rather than between their last two orders.
     */
    firstPlacedAt?: string
    /** Lifetime gross divided by order count, absent for a never-buyer. */
    averageGross?: number
  }
  /**
   * RFM, scored against THIS shop's buyers rather than against fixed day counts — see `lib/engine/rfm.ts`.
   *
   * Null for anybody who has never ordered, and null on a shop with too few buyers to rank against. An
   * audience compares the digits (`rfm.monetary >= 4`) or sorts on `rfm.total`.
   */
  rfm: {
    recency: number
    frequency: number
    monetary: number
    cell: string
    total: number
  } | null
  /**
   * What this customer is worth, and what they may be worth if they carry on.
   *
   * A PROJECTION from their own observed cadence, not a model — the arithmetic is stated in `rfm.ts` so an
   * operator can argue with it. Every forward-looking key is ABSENT until there is a cadence to project from,
   * because one order is not a rate.
   */
  value: {
    averageOrderGross: number
    ordersPerYear?: number
    projectedAnnualGross?: number
    projectedHorizonGross?: number
    /** Position among the shop's buyers by lifetime spend, to the nearest 5th percentile. */
    grossPercentile?: number
  } | null
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
  /**
   * The customer's most recent NPS answer, or null when they have never answered one.
   *
   * Null rather than absent, and that is safe here: every comparison an author can write against it is a
   * magnitude comparison, which `matchesAudience` vetoes for a null operand — so a customer who never
   * answered can never match `survey.nps <= 6` however it is phrased.
   */
  survey: { nps: number | null; answeredAt: string | null }
  /**
   * What this customer has done with the messages we sent them.
   *
   * The data existed from Phase 3 and only one screen could read it: an audience could not ask about it at all,
   * so "has not opened anything in six months" — the basis of every re-engagement campaign and of the sunset
   * policy that protects a sending domain — was unwritable.
   *
   * Opens and clicks are counted as unique RUNS, like everywhere else in this module: a mail client re-fetching a
   * pixel is not a second reader.
   */
  engagement: {
    /** Messages actually sent to them, all time. Zero is meaningful: we have never written to them. */
    sent: number
    opened: number
    clicked: number
    lastSentAt?: string
    /** The last open or click. Absent when they have never done either. */
    lastEngagedAt?: string
    /**
     * Days since their last sign of life — and the key a sunset audience is built on.
     *
     * For somebody who HAS engaged, it is days since that open or click. For somebody who never has, it is days
     * since we FIRST wrote to them. That definition is the whole point: `engagement.daysSinceEngaged >= 180`
     * then means "no sign of life in six months" and includes the customer who has never once opened anything —
     * while sparing the one who was added last week and has not had time to.
     *
     * ABSENT, never null, when we have never sent them anything: there is no silence to measure, and a zero
     * would make every sunset audience true for somebody we have never written to.
     */
    daysSinceEngaged?: number
  }
  /**
   * Slugs of the saved segments this customer is in, so an audience can say
   * `segments CONTAINS 'lapsed-vip'` — and `NOT CONTAINS` for the negative case.
   *
   * Computed from the rest of this document, which is why a segment may not be defined in terms of
   * segments: it would evaluate against a key that is still being built.
   */
  segments: string[]
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
