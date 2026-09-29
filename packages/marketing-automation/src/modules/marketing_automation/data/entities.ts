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
  /**
   * Which sweep source iterates for this trigger. A registry id (`lib/sweep-sources.ts`), kept as
   * plain text rather than a union here: sources are additive and a third-party module may contribute
   * one, so the enum belongs in the validator that guards writes, not in the column's type.
   */
  @Property({ name: 'sweep_source', type: 'text', nullable: true })
  sweepSource?: string | null

  /** Source-specific knobs, e.g. `{ withinDays: 7 }` for expiring quotes. */
  @Property({ name: 'sweep_params', type: 'jsonb', nullable: true })
  sweepParams?: Record<string, unknown> | null

  /**
   * When this trigger last swept. The module's tick is fixed, so this is what makes a campaign's
   * own `scheduleValue` mean something instead of being decoration.
   */
  @Property({ name: 'last_swept_at', type: Date, nullable: true })
  lastSweptAt?: Date | null

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
/**
 * One run per (campaign, event occurrence), enforced by the database rather than by a check.
 *
 * A check-then-insert cannot be made safe: two workers handed the same redelivered job both read
 * "no run yet" and both insert. Partial, so the sweep's key-less runs are unaffected, and erasable,
 * so a legitimate repeat after the window is still allowed.
 */
/**
 * One ACTIVE run per (campaign, subject), enforced by the database.
 *
 * `hasActiveRun` checks this before enrolling, but a check is a read: the dispatch worker runs eight
 * jobs at a time, so two events for the same subject can both pass it and both insert — and the
 * customer then walks the campaign twice, which is exactly what the check exists to prevent. The
 * occurrence index does not cover it, because those two runs come from DIFFERENT events and so carry
 * different keys.
 *
 * Partial on the active statuses, so a customer may legitimately enter again once the previous run has
 * completed or died, and on a non-null subject, because a subject-less run is not about anybody.
 */
@Index({
  name: 'marketing_runs_active_subject_uniq',
  expression:
    `create unique index "marketing_runs_active_subject_uniq" on "marketing_campaign_runs" ("tenant_id", "organization_id", "campaign_id", "subject_entity_id") where subject_entity_id is not null and status in ('running', 'waiting', 'claimed')`,
})
@Index({
  name: 'marketing_runs_occurrence_uniq',
  expression:
    'create unique index "marketing_runs_occurrence_uniq" on "marketing_campaign_runs" ("tenant_id", "organization_id", "campaign_id", "occurrence_key") where occurrence_key is not null',
})
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

  /**
   * Identifies the event delivery that started this run, so a redelivery cannot start a second one.
   *
   * Null for a run a sweep started — a sweep has no event occurrence, and its re-entry policy is
   * what governs repeats there. Erased once the dedup window has passed, which is what keeps the
   * unique index below from turning every `unlimited` re-entry policy into `once`.
   */
  @Property({ name: 'occurrence_key', type: 'text', nullable: true })
  occurrenceKey?: string | null

  /**
   * Which lane each split assigned this run, recorded when the run started.
   *
   * Stored rather than recomputed. The choice is deterministic, so recomputing it from the definition
   * would agree — until the author edits the split, at which point every historical run would be
   * re-attributed to a lane it never walked, and an A/B result would quietly become fiction.
   */
  @Property({ name: 'variant_choices', type: 'jsonb', nullable: true })
  variantChoices?: Record<string, string> | null

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

/**
 * What happened to a message after it left: delivered, opened, clicked, bounced.
 *
 * Append-only and keyed to the SEND rather than to the person. That is the whole privacy stance of
 * this table: it deliberately stores no IP address and no user agent, because the question it exists
 * to answer — did this campaign work — never needs them, and a marketing module that quietly builds
 * a device-and-location log of every recipient is a liability nobody asked for.
 *
 * `send_id` is resolved when the event arrives and stays nullable: the tracking token identifies the
 * run and step, which exist before the send row is written, so an event can never be lost merely
 * because it arrived in an unexpected order.
 */
@Entity({ tableName: 'marketing_message_send_events' })
@Index({ name: 'mkt_send_events_campaign_idx', properties: ['tenantId', 'organizationId', 'campaignId', 'type'] })
@Index({ name: 'mkt_send_events_run_step_idx', properties: ['tenantId', 'organizationId', 'runId', 'stepId'] })
@Index({ name: 'mkt_send_events_send_idx', properties: ['sendId', 'type'] })
export class MarketingMessageSendEvent {
  [OptionalProps]?: 'occurredAt' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'campaign_id', type: 'uuid' })
  campaignId!: string

  @Property({ name: 'run_id', type: 'uuid' })
  runId!: string

  @Property({ name: 'step_id', type: 'text' })
  stepId!: string

  /** The send this belongs to, once one has been recorded. */
  @Property({ name: 'send_id', type: 'uuid', nullable: true })
  sendId?: string | null

  @Property({ type: 'text' })
  type!: 'delivered' | 'opened' | 'clicked' | 'bounced'

  /**
   * The link a click went to. Truncated on write, because it is an author-authored URL and this
   * column is not the place to discover how long one can be.
   */
  @Property({ name: 'link_url', type: 'text', nullable: true })
  linkUrl?: string | null

  @Property({ name: 'occurred_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  occurredAt!: Date

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  createdAt!: Date
}

/**
 * One award or deduction of lead-score points, as a LEDGER rather than a running total.
 *
 * A total in a column would have to be incremented, and an increment is the one write that cannot be
 * made idempotent by retrying it: a step that awards 10 points and is redelivered would award 20.
 * Entries are keyed by the run and step that produced them, so the second attempt collides instead of
 * double-counting, and the score is `sum(points)` — the same shape as the order aggregates the
 * subject document already computes, which means the audience narrowing can push it down for free.
 *
 * The ledger also answers "why does this customer have 40 points", which a total never can.
 */
@Entity({ tableName: 'marketing_customer_score_entries' })
@Index({ name: 'mkt_score_subject_idx', properties: ['tenantId', 'organizationId', 'subjectEntityId'] })
@Index({ name: 'mkt_score_campaign_idx', properties: ['tenantId', 'organizationId', 'campaignId'] })
/**
 * One entry per (run, step), enforced by the database.
 *
 * Partial, because a manual adjustment has no run and several of them are legitimate; a check in code
 * could not hold, since two workers handed the same redelivered job would both read "not awarded yet".
 */
@Index({
  name: 'marketing_score_entry_step_uniq',
  expression:
    'create unique index "marketing_score_entry_step_uniq" on "marketing_customer_score_entries" ("tenant_id", "organization_id", "run_id", "step_id") where run_id is not null',
})
export class MarketingCustomerScoreEntry {
  [OptionalProps]?: 'occurredAt' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'subject_entity_id', type: 'uuid' })
  subjectEntityId!: string

  /** Signed: a campaign can deduct points as well as award them. */
  @Property({ type: 'integer' })
  points!: number

  /** Why, in the author's words. Shown in the customer profile, never interpreted. */
  @Property({ type: 'text', nullable: true })
  reason?: string | null

  @Property({ type: 'text' })
  source!: 'campaign' | 'manual' | 'rule'

  @Property({ name: 'campaign_id', type: 'uuid', nullable: true })
  campaignId?: string | null

  @Property({ name: 'run_id', type: 'uuid', nullable: true })
  runId?: string | null

  @Property({ name: 'step_id', type: 'text', nullable: true })
  stepId?: string | null

  @Property({ name: 'occurred_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  occurredAt!: Date

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  createdAt!: Date
}

/**
 * Whether a customer wants marketing on a channel.
 *
 * One row per (customer, channel) with the current state, plus the reason and where it came from. A
 * LEDGER was considered and rejected here, unlike the score: what a send gate needs is the current
 * answer, the legal requirement is to honour it immediately, and an append-only history would put the
 * authoritative answer behind an aggregate on the hottest path in the module. The audit trail that a
 * regulator asks for is the separate consent log below, which is append-only.
 *
 * Absence means "never said" — which this module treats as permitted, because the platform has no
 * global consent model to inherit from and inventing an opt-in default here would silently disable
 * every campaign on every existing installation. That decision is stated in the spec rather than
 * hidden in a column default.
 */
@Entity({ tableName: 'marketing_consents' })
@Unique({ name: 'marketing_consents_subject_channel_uniq', properties: ['tenantId', 'organizationId', 'subjectEntityId', 'channel'] })
export class MarketingConsent {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'subject_entity_id', type: 'uuid' })
  subjectEntityId!: string

  @Property({ type: 'text' })
  channel!: 'email' | 'sms' | 'push'

  @Property({ type: 'text' })
  state!: 'subscribed' | 'unsubscribed'

  /** What the customer said, or what an operator recorded. Never interpreted. */
  @Property({ type: 'text', nullable: true })
  reason?: string | null

  /** How it was decided: the customer clicked, an operator set it, or an import brought it. */
  @Property({ type: 'text' })
  source!: 'customer' | 'operator' | 'import'

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt!: Date
}

/**
 * Append-only record of every consent change.
 *
 * Separate from the state above because the two answer different questions and have opposite access
 * patterns: the gate needs one current row per send, a regulator needs the whole history and never in a
 * hurry. Keeping them together would mean either an aggregate on the send path or a history that can be
 * overwritten — and a consent audit trail that can be overwritten is not an audit trail.
 */
@Entity({ tableName: 'marketing_consent_events' })
@Index({ name: 'mkt_consent_events_subject_idx', properties: ['tenantId', 'organizationId', 'subjectEntityId'] })
export class MarketingConsentEvent {
  [OptionalProps]?: 'occurredAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'subject_entity_id', type: 'uuid' })
  subjectEntityId!: string

  @Property({ type: 'text' })
  channel!: 'email' | 'sms' | 'push'

  @Property({ type: 'text' })
  state!: 'subscribed' | 'unsubscribed'

  @Property({ type: 'text', nullable: true })
  reason?: string | null

  @Property({ type: 'text' })
  source!: 'customer' | 'operator' | 'import'

  /** The campaign whose message prompted the change, when there was one. */
  @Property({ name: 'campaign_id', type: 'uuid', nullable: true })
  campaignId?: string | null

  @Property({ name: 'occurred_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  occurredAt!: Date
}

/**
 * One NPS question put to one customer, and their answer if it came.
 *
 * The row is created when the question is SENT rather than when it is answered, so an unanswered survey is
 * visible: a response rate you cannot see is a response rate you will quietly assume is fine. Keyed by the
 * run and step that asked, which is what makes a retried step reuse the row instead of asking twice.
 */
@Entity({ tableName: 'marketing_survey_prompts' })
@Unique({ name: 'marketing_survey_prompts_step_uniq', properties: ['tenantId', 'organizationId', 'runId', 'stepId'] })
@Index({ name: 'mkt_survey_subject_idx', properties: ['tenantId', 'organizationId', 'subjectEntityId'] })
@Index({ name: 'mkt_survey_campaign_idx', properties: ['tenantId', 'organizationId', 'campaignId'] })
export class MarketingSurveyPrompt {
  [OptionalProps]?: 'askedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'subject_entity_id', type: 'uuid', nullable: true })
  subjectEntityId?: string | null

  @Property({ name: 'campaign_id', type: 'uuid' })
  campaignId!: string

  @Property({ name: 'run_id', type: 'uuid' })
  runId!: string

  @Property({ name: 'step_id', type: 'text' })
  stepId!: string

  /** The question as the author wrote it, kept so a later answer can be read in context. */
  @Property({ type: 'text' })
  question!: string

  /** 0–10, or null while unanswered. */
  @Property({ type: 'integer', nullable: true })
  score?: number | null

  /** Whatever the customer chose to add. Never interpreted, and never required. */
  @Property({ type: 'text', nullable: true })
  comment?: string | null

  @Property({ name: 'asked_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  askedAt!: Date

  @Property({ name: 'answered_at', type: Date, nullable: true })
  answeredAt?: Date | null
}

/**
 * A named piece of HTML an author can reuse across messages.
 *
 * The point is that a footer, a logo header or a seasonal banner lives in ONE place: a shop that edits its
 * address in fourteen campaigns will get it wrong in at least one of them.
 *
 * `html` is trusted author content, at exactly the same trust level as a campaign's own body — both are
 * written by somebody holding `campaigns.manage`, and both are inserted unescaped. That is why this entity
 * is behind that permission and why a block is never built from customer input.
 */
@Entity({ tableName: 'marketing_content_blocks' })
/**
 * Unique among LIVE blocks only.
 *
 * A plain unique constraint would burn a key on deletion: remove a footer by mistake and the word `footer`
 * is unusable for that tenant forever, with a duplicate-key error as the only explanation.
 */
@Index({
  name: 'marketing_content_blocks_key_uniq',
  expression:
    'create unique index "marketing_content_blocks_key_uniq" on "marketing_content_blocks" ("tenant_id", "organization_id", "key") where deleted_at is null',
})
@Index({ name: 'mkt_content_blocks_scope_idx', properties: ['tenantId', 'organizationId', 'deletedAt'] })
export class MarketingContentBlock {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /** What an author types in a message: `{{block:footer}}`. Slug-shaped so it is safe in that syntax. */
  @Property({ type: 'text' })
  key!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  html!: string

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  createdAt!: Date

  /** Carries the optimistic lock: two people editing the shared footer must collide, not overwrite. */
  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt!: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * A signed URL that lets something outside the platform start one campaign.
 *
 * The TOKEN is not stored — it is an HMAC over this row's id, so the URL can always be shown again and a
 * copy of the database yields nothing usable without the secret. Revocation is a column, checked on every
 * receipt, which is the part a derived token cannot do on its own.
 */
@Entity({ tableName: 'marketing_inbound_hooks' })
@Index({ name: 'mkt_inbound_hooks_scope_idx', properties: ['tenantId', 'organizationId', 'deletedAt'] })
@Index({ name: 'mkt_inbound_hooks_campaign_idx', properties: ['tenantId', 'organizationId', 'campaignId'] })
export class MarketingInboundHook {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'receivedCount'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /** The campaign this hook enrols into. A hook without one could not do anything. */
  @Property({ name: 'campaign_id', type: 'uuid' })
  campaignId!: string

  @Property({ type: 'text' })
  name!: string

  /** Set to stop accepting posts without losing the record of what the hook did. */
  @Property({ name: 'revoked_at', type: Date, nullable: true })
  revokedAt?: Date | null

  /** Two counters, because "it is configured" and "it is being used" are different questions. */
  @Property({ name: 'received_count', type: 'int', default: 0 })
  receivedCount!: number

  @Property({ name: 'last_received_at', type: Date, nullable: true })
  lastReceivedAt?: Date | null

  /**
   * Why the last post did not identify anybody, for the admin screen.
   *
   * The endpoint itself answers the same thing to every caller — a public URL must not become an
   * address-existence oracle — so this column is where an integrator's debugging actually happens.
   */
  @Property({ name: 'last_outcome', type: 'text', nullable: true })
  lastOutcome?: string | null

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt!: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * What a campaign looked like after each save.
 *
 * Two jobs in one table, because they are the same data: the audit trail of who changed a campaign and
 * when, and the versions an author can go back to. Storing the state AFTER each save rather than before
 * means version 1 is the first save rather than a gap, and a restore is just another save.
 */
@Entity({ tableName: 'marketing_campaign_revisions' })
@Unique({ name: 'marketing_revisions_version_uniq', properties: ['tenantId', 'organizationId', 'campaignId', 'version'] })
@Index({ name: 'mkt_revisions_campaign_idx', properties: ['tenantId', 'organizationId', 'campaignId'] })
export class MarketingCampaignRevision {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'campaign_id', type: 'uuid' })
  campaignId!: string

  /** Monotonic per campaign, so "version 4" means something to a person reading a list. */
  @Property({ type: 'int' })
  version!: number

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'json' })
  definition!: Record<string, unknown>

  /** Triggers live in their own table, so a restorable snapshot has to carry them too. */
  @Property({ type: 'json' })
  triggers!: unknown[]

  /**
   * Who saved it. Nullable because a save can come from a command with no user — a restore run by a
   * scheduled task, or an API key — and inventing an actor would be worse than admitting none.
   */
  @Property({ name: 'actor_id', type: 'text', nullable: true })
  actorId?: string | null

  /** What kind of save this was: an edit, or a restore of an earlier version. */
  @Property({ type: 'text' })
  note!: string

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  createdAt!: Date
}

/**
 * One execution of a background job, with the numbers it produced.
 *
 * The question this answers is the morning-after one: did the sweep run at all, how many customers did it
 * look at, and how many did it enrol. Counters are jsonb because each job counts different things and a
 * column per counter would be a migration per job.
 */
@Entity({ tableName: 'marketing_job_runs' })
@Index({ name: 'mkt_job_runs_kind_idx', properties: ['tenantId', 'organizationId', 'kind', 'startedAt'] })
export class MarketingJobRun {
  [OptionalProps]?: 'startedAt' | 'status'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /** `sweep`, `due_runs`, `dispatch` — a string rather than an enum so a new job needs no migration. */
  @Property({ type: 'text' })
  kind!: string

  /** Set when the job was about one campaign, which the sweep is and the due-run scan is not. */
  @Property({ name: 'campaign_id', type: 'uuid', nullable: true })
  campaignId?: string | null

  @Property({ name: 'started_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  startedAt!: Date

  @Property({ name: 'finished_at', type: Date, nullable: true })
  finishedAt?: Date | null

  /** `running` until it ends, so a job that never finished is visible as exactly that. */
  @Property({ type: 'text', default: 'running' })
  status!: string

  @Property({ type: 'json', nullable: true })
  counters?: Record<string, number> | null

  /** Already redacted by the caller where it could name a recipient. */
  @Property({ type: 'text', nullable: true })
  error?: string | null
}

/**
 * One customer's referral code.
 *
 * One live code per customer, not per campaign: a person hands out their code, and a second code for the same
 * person would split the credit for the same word of mouth. Unique among LIVE rows so a revoked code's
 * characters are not burnt forever.
 */
@Entity({ tableName: 'marketing_referral_codes' })
@Index({
  name: 'marketing_referral_code_uniq',
  expression:
    'create unique index "marketing_referral_code_uniq" on "marketing_referral_codes" ("tenant_id", "organization_id", "code") where deleted_at is null',
})
@Index({
  name: 'marketing_referral_referrer_uniq',
  expression:
    'create unique index "marketing_referral_referrer_uniq" on "marketing_referral_codes" ("tenant_id", "organization_id", "referrer_entity_id") where deleted_at is null',
})
export class MarketingReferralCode {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /**
   * The customer who shares it, and who the conversion event is about.
   *
   * NULLABLE because erasure unlinks rather than deletes: the redemption counts a referrer was paid on must
   * stay true after the referred person exercises their right to be forgotten, and vice versa. A live code
   * always has one — erasure retires the code in the same statement that clears it.
   */
  @Property({ name: 'referrer_entity_id', type: 'uuid', nullable: true })
  referrerEntityId?: string | null

  @Property({ type: 'text' })
  code!: string

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt!: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * One person arriving on somebody else's code, and what became of it.
 *
 * Two stages, because a referral is claimed before it is worth anything: `pending` when the code was entered,
 * `converted` when that person placed their first order. The trigger fires on the second, which is the only
 * one a shop should pay a reward for.
 *
 * Unique per referred customer among live rows: being referred is something that happens to a person once,
 * and a second claim would let somebody collect twice for the same arrival.
 */
@Entity({ tableName: 'marketing_referral_redemptions' })
@Index({
  name: 'marketing_referral_referred_uniq',
  expression:
    'create unique index "marketing_referral_referred_uniq" on "marketing_referral_redemptions" ("tenant_id", "organization_id", "referred_entity_id")',
})
@Index({ name: 'mkt_referral_redemptions_code_idx', properties: ['tenantId', 'organizationId', 'codeId'] })
@Index({ name: 'mkt_referral_redemptions_status_idx', properties: ['tenantId', 'organizationId', 'status'] })
export class MarketingReferralRedemption {
  [OptionalProps]?: 'createdAt' | 'status'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'code_id', type: 'uuid' })
  codeId!: string

  /** Denormalised from the code so a conversion needs one read, not two. Nullable for erasure — see the code. */
  @Property({ name: 'referrer_entity_id', type: 'uuid', nullable: true })
  referrerEntityId?: string | null

  @Property({ name: 'referred_entity_id', type: 'uuid', nullable: true })
  referredEntityId?: string | null

  /** `pending` until the referred customer orders, then `converted`. */
  @Property({ type: 'text', default: 'pending' })
  status!: string

  /** The order that converted it, so the reward can be traced to a real purchase. */
  @Property({ name: 'order_id', type: 'uuid', nullable: true })
  orderId?: string | null

  /** What that order was worth, kept as text like every other money value read from sales. */
  @Property({ name: 'order_total', type: 'text', nullable: true })
  orderTotal?: string | null

  @Property({ name: 'converted_at', type: Date, nullable: true })
  convertedAt?: Date | null

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  createdAt!: Date
}

/**
 * A named audience expression, reusable across campaigns.
 *
 * The expression is the SAME `business_rules` condition tree a campaign audience uses — there is no second
 * condition language here, and that is the whole reason a segment is cheap: membership is already computable
 * for any subject document, and narrowing already knows how to push down the parts it can.
 */
@Entity({ tableName: 'marketing_segments' })
@Index({
  name: 'marketing_segments_slug_uniq',
  expression:
    'create unique index "marketing_segments_slug_uniq" on "marketing_segments" ("tenant_id", "organization_id", "slug") where deleted_at is null',
})
@Index({ name: 'mkt_segments_scope_idx', properties: ['tenantId', 'organizationId', 'deletedAt'] })
export class MarketingSegment {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /** What an audience references: `segments CONTAINS 'lapsed-vip'`. Immutable once saved. */
  @Property({ type: 'text' })
  slug!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  /** A `ConditionExpression`; null means "everybody", which is a legitimate if unusual segment. */
  @Property({ type: 'json', nullable: true })
  expression?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt!: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * How big a segment was, on a day.
 *
 * A segment's definition is fixed and its membership is not, so "how many people are in it" is only ever an
 * answer about a moment. One row per segment per day is enough to see a trend — the question this answers is
 * "is the lapsed-customer segment growing", and that is not a question with an hourly answer.
 */
@Entity({ tableName: 'marketing_segment_snapshots' })
@Unique({ name: 'marketing_segment_snapshot_day_uniq', properties: ['tenantId', 'organizationId', 'segmentId', 'day'] })
@Index({ name: 'mkt_segment_snapshots_idx', properties: ['tenantId', 'organizationId', 'segmentId', 'day'] })
export class MarketingSegmentSnapshot {
  [OptionalProps]?: 'takenAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'segment_id', type: 'uuid' })
  segmentId!: string

  /** The calendar day, as `YYYY-MM-DD`, which is what makes one-per-day enforceable by an index. */
  @Property({ type: 'text' })
  day!: string

  @Property({ type: 'int' })
  size!: number

  /**
   * Whether that number was the whole population or a bounded sample.
   *
   * Stored with the number, because a series that mixes exact counts and sampled ones without saying so is a
   * chart that lies about a trend.
   */
  @Property({ type: 'text' })
  qualifier!: string

  @Property({ name: 'taken_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  takenAt!: Date
}

/**
 * A customer waiting for a product to get cheaper.
 *
 * The highest-intent signal a shop gets: somebody has told you exactly what they want and what would make
 * them buy. Keyed on the SKU rather than a catalogue id, for the same reason the order-line snapshot is —
 * a SKU is what a customer, an importer and a feed all agree on, and it survives a product being replaced.
 *
 * `watchedPriceGross` is the price when the watch started (or when the customer was last told), so a drop is
 * measured against what THEY last saw. Measuring against an all-time low would tell somebody a price
 * dropped when it had only returned to where they first met it.
 */
@Entity({ tableName: 'marketing_product_watches' })
@Index({
  name: 'marketing_product_watch_uniq',
  expression:
    'create unique index "marketing_product_watch_uniq" on "marketing_product_watches" ("tenant_id", "organization_id", "subject_entity_id", "sku") where deleted_at is null',
})
@Index({ name: 'mkt_product_watches_sku_idx', properties: ['tenantId', 'organizationId', 'sku'] })
export class MarketingProductWatch {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'notifiedCount'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /** The customer who is waiting, and the subject of the campaign the drop starts. */
  @Property({ name: 'subject_entity_id', type: 'uuid' })
  subjectEntityId!: string

  @Property({ type: 'text' })
  sku!: string

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  /**
   * The price this customer last saw, as text.
   *
   * Money from the catalogue is `numeric` mapped to string everywhere else in this codebase; storing it as a
   * float here to save a parse would introduce the one rounding class of bug nobody finds until a customer
   * is told about a one-cent drop.
   */
  @Property({ name: 'watched_price_gross', type: 'text', nullable: true })
  watchedPriceGross?: string | null

  @Property({ name: 'notified_at', type: Date, nullable: true })
  notifiedAt?: Date | null

  /** How many times this watch has fired, which is what makes an unwanted repeat visible. */
  @Property({ name: 'notified_count', type: 'int', default: 0 })
  notifiedCount!: number

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt!: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * What the recipient asked for themselves.
 *
 * Separate from consent, which is permission, and from the campaign's send policy, which is the shop being
 * careful. This is a person saying "less often" or "not until March" — the middle ground whose absence is why
 * people unsubscribe instead.
 */
@Entity({ tableName: 'marketing_contact_preferences' })
@Unique({ name: 'marketing_contact_preference_uniq', properties: ['tenantId', 'organizationId', 'subjectEntityId'] })
export class MarketingContactPreference {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'subject_entity_id', type: 'uuid' })
  subjectEntityId!: string

  /** Their own ceiling, messages per week. Null when they have expressed none. */
  @Property({ name: 'max_per_week', type: 'int', nullable: true })
  maxPerWeek?: number | null

  /** "Not until then". A pause defers messages; it is not an unsubscribe. */
  @Property({ name: 'paused_until', type: Date, nullable: true })
  pausedUntil?: Date | null

  /**
   * The language they want to be written to in.
   *
   * Kept HERE rather than on the customer record, because the platform has no language field on a customer and
   * adding one would be a change to the customers module for a marketing need. A locale the person chose
   * themselves is also the only one worth trusting — a guess from an address is how people get emailed in the
   * language of the country they happen to live in.
   */
  @Property({ type: 'text', nullable: true })
  locale?: string | null

  /**
   * Where the preference came from — `portal` when the customer set it themselves.
   *
   * Worth recording for the same reason consent records its source: "provably first-party" is a claim somebody
   * may have to substantiate, and a preference set by an operator is a different fact.
   */
  @Property({ type: 'text' })
  source!: string

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date() })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt!: Date
}
