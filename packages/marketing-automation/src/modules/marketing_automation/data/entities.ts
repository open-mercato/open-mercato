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
