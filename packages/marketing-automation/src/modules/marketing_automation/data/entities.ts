import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * A campaign: which platform events start it, who it applies to, and what it does.
 *
 * The authored graph lives in one `definition` jsonb column rather than child tables. That
 * keeps a save a single row update — no delete-and-reinsert of child rows, so step ids stay
 * stable and an in-flight run is never orphaned by an edit. Triggers are the exception: they
 * are projected into their own indexed table because "which campaigns listen to this event"
 * is the one query that runs on every single platform event.
 */
@Entity({ tableName: 'marketing_campaigns' })
@Index({ name: 'mkt_campaigns_scope_enabled_idx', properties: ['tenantId', 'organizationId', 'isEnabled'] })
@Index({ name: 'mkt_campaigns_scope_deleted_idx', properties: ['tenantId', 'organizationId', 'deletedAt'] })
export class MarketingCampaign {
  [OptionalProps]?: 'isEnabled' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  /** Default off: a half-authored campaign must never send. */
  @Property({ name: 'is_enabled', type: 'boolean', default: false })
  isEnabled!: boolean

  /** `CampaignDefinition` — audience expression, ordered steps, canvas layout. */
  @Property({ type: 'jsonb' })
  definition!: Record<string, unknown>

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt!: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * Projection of the campaign's triggers, one row per way the campaign can start.
 *
 * Two kinds, because marketing campaigns genuinely start two ways:
 *
 *  - `event` — a platform event id (`sales.order.created`) reacts to something that happened.
 *    Using the event id directly rather than an invented code means there is no translation
 *    layer to keep in sync and any module's event can start a campaign.
 *  - `schedule` — a periodic sweep over the audience, which is how "customers who have not
 *    ordered in 90 days" has to work: nothing happens to make somebody inactive, so there is
 *    no event to react to.
 *
 * Kept in its own indexed table rather than inside the campaign's jsonb because "which
 * campaigns listen to this event" runs on every single platform event.
 */
@Entity({ tableName: 'marketing_campaign_triggers' })
@Unique({ name: 'mkt_triggers_campaign_event_uq', properties: ['campaignId', 'eventId'] })
@Index({ name: 'mkt_triggers_lookup_idx', properties: ['tenantId', 'organizationId', 'eventId'] })
@Index({ name: 'mkt_triggers_kind_idx', properties: ['tenantId', 'organizationId', 'kind'] })
export class MarketingCampaignTrigger {
  [OptionalProps]?: 'kind' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'campaign_id', type: 'uuid' })
  campaignId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text', default: 'event' })
  kind!: 'event' | 'schedule'

  /** Set for `event` triggers. Null for a scheduled sweep. */
  @Property({ name: 'event_id', type: 'text', nullable: true })
  eventId?: string | null

  /** Set for `schedule` triggers: an interval or cron expression the sweep runs on. */
  @Property({ name: 'schedule_value', type: 'text', nullable: true })
  scheduleValue?: string | null

  /**
   * How long a subject stays ineligible for re-entry after a run of this campaign.
   *
   * A sweep re-evaluates the same audience every tick, so without this a customer who has not
   * ordered in 90 days would be mailed on every single tick. Null means "enrol at most once,
   * ever".
   */
  @Property({ name: 'reentry_after_days', type: 'integer', nullable: true })
  reentryAfterDays?: number | null

  /**
   * What a scheduled sweep iterates over. Set for `schedule` triggers, null for `event`.
   *
   * A sweep has to be told its candidate set, because the two useful kinds are genuinely
   * different shapes: re-engagement walks customers and asks "is this one dormant", while
   * offer-expiry walks quotes and asks "does this one lapse soon". Collapsing them into one
   * source would mean scanning every customer to find a handful of expiring quotes.
   */
  @Property({ name: 'sweep_source', type: 'text', nullable: true })
  sweepSource?: 'customers' | 'expiring_quotes' | null

  /** Source-specific knobs, e.g. `{ withinDays: 7 }` for expiring quotes. */
  @Property({ name: 'sweep_params', type: 'jsonb', nullable: true })
  sweepParams?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt!: Date
}

/**
 * One subject's journey through one campaign.
 *
 * This single table does three jobs that were separate concerns in the Magento original: it
 * parks a waiting journey, it records what each step did, and it is the source for campaign
 * reporting. `stepLog` is an append-only array of per-step outcomes, which is what a funnel
 * reads.
 *
 * The claim is deliberately separate from completion: `status='claimed'` plus `claimedAt` and
 * `claimToken` hold the row under a lease, while `completedAt` records the end. A worker that
 * dies mid-step leaves a claimed row that the lease lets another worker recover, instead of
 * stranding it forever.
 */
@Entity({ tableName: 'marketing_campaign_runs' })
@Index({ name: 'mkt_runs_due_idx', properties: ['resumeAt', 'status'] })
@Index({ name: 'mkt_runs_entry_idx', properties: ['campaignId', 'subjectEntityId', 'status'] })
@Index({ name: 'mkt_runs_scope_idx', properties: ['tenantId', 'organizationId', 'status'] })
export class MarketingCampaignRun {
  [OptionalProps]?: 'currentStepIndex' | 'stepLog' | 'status' | 'attempts' | 'startedAt' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'campaign_id', type: 'uuid' })
  campaignId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /** Denormalized so the re-entry guard never has to decode the context blob. */
  @Property({ name: 'subject_entity_id', type: 'uuid', nullable: true })
  subjectEntityId?: string | null

  @Property({ name: 'trigger_event_id', type: 'text' })
  triggerEventId!: string

  /** JSON-serializable dispatch context, including patches earlier steps contributed. */
  @Property({ type: 'jsonb' })
  context!: Record<string, unknown>

  /** Index of the step to execute next. */
  @Property({ name: 'current_step_index', type: 'integer', default: 0 })
  currentStepIndex!: number

  @Property({ name: 'step_log', type: 'jsonb', default: '[]' })
  stepLog!: Record<string, unknown>[]

  @Property({ type: 'text', default: 'running' })
  status!: 'running' | 'waiting' | 'claimed' | 'completed' | 'failed' | 'dead'

  /** When a wait step parked this run. */
  @Property({ name: 'resume_at', type: Date, nullable: true })
  resumeAt?: Date | null

  @Property({ name: 'claimed_at', type: Date, nullable: true })
  claimedAt?: Date | null

  @Property({ name: 'claim_token', type: 'uuid', nullable: true })
  claimToken?: string | null

  @Property({ type: 'integer', default: 0 })
  attempts!: number

  @Property({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string | null

  @Property({ name: 'next_retry_at', type: Date, nullable: true })
  nextRetryAt?: Date | null

  @Property({ name: 'started_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  startedAt!: Date

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt!: Date
}

/**
 * Append-only record of a dispatch that could not be processed at all.
 *
 * Scope columns are nullable because a malformed payload may not identify either. `updatedAt`
 * exists only for uniformity with the repo's column convention and is never written — this is
 * not a user-editable entity.
 */
@Entity({ tableName: 'marketing_dispatch_dead_letters' })
@Index({ name: 'mkt_dead_letters_created_idx', properties: ['createdAt'] })
export class MarketingDispatchDeadLetter {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ type: 'text' })
  source!: 'dispatch' | 'resume'

  @Property({ name: 'event_id', type: 'text', nullable: true })
  eventId?: string | null

  @Property({ name: 'campaign_id', type: 'uuid', nullable: true })
  campaignId?: string | null

  @Property({ type: 'jsonb' })
  payload!: Record<string, unknown>

  @Property({ type: 'text' })
  error!: string

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt!: Date
}

/**
 * One outbound message a campaign sent, per subject per channel.
 *
 * Exists so volume can be capped ACROSS campaigns: a frequency cap that only counted sends
 * within its own campaign would let five campaigns each politely send one message and still
 * bury the customer. This is also the table a delivery/funnel report reads, which is why it
 * records suppressions rather than silently dropping them.
 */
@Entity({ tableName: 'marketing_message_sends' })
@Index({ name: 'mkt_sends_subject_window_idx', properties: ['tenantId', 'organizationId', 'subjectEntityId', 'sentAt'] })
@Index({ name: 'mkt_sends_campaign_idx', properties: ['campaignId', 'sentAt'] })
export class MarketingMessageSend {
  [OptionalProps]?: 'status' | 'sentAt' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'campaign_id', type: 'uuid', nullable: true })
  campaignId?: string | null

  @Property({ name: 'run_id', type: 'uuid', nullable: true })
  runId?: string | null

  @Property({ name: 'step_id', type: 'text', nullable: true })
  stepId?: string | null

  @Property({ name: 'subject_entity_id', type: 'uuid', nullable: true })
  subjectEntityId?: string | null

  @Property({ type: 'text' })
  channel!: 'email' | 'sms' | 'push'

  @Property({ name: 'to_address', type: 'text', nullable: true })
  toAddress?: string | null

  /** `suppressed` records a send the frequency cap or quiet hours refused, with a reason. */
  @Property({ type: 'text', default: 'sent' })
  status!: 'sent' | 'suppressed' | 'failed'

  @Property({ name: 'suppression_reason', type: 'text', nullable: true })
  suppressionReason?: string | null

  @Property({ name: 'sent_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  sentAt!: Date

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt!: Date
}
