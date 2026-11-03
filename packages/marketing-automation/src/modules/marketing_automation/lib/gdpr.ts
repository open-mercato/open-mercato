import type { EntityManager } from '@mikro-orm/postgresql'
import {
  MarketingCampaignRun,
  MarketingConsent,
  MarketingDispatchDeadLetter,
  MarketingConsentEvent,
  MarketingContactPreference,
  MarketingCustomerScoreEntry,
  MarketingSubjectErasure,
  MarketingMessageSend,
  MarketingMessageSendEvent,
  MarketingProductWatch,
  MarketingReferralCode,
  MarketingReferralRedemption,
  MarketingSurveyPrompt,
} from '../data/entities.js'
import type { SubjectScope } from './subject-document.js'

/**
 * Everything this module holds about one person, and how to stop holding it.
 *
 * Both halves live here because they must agree: an export that omits a table is a lie to the person
 * asking, and an erasure that misses the same table is a lie to the regulator. The list of tables is
 * written once, and the tests assert the two functions cover the same set.
 */

export type SubjectExport = {
  subjectEntityId: string
  exportedAt: string
  consent: Array<{ channel: string; state: string; reason: string | null; source: string; updatedAt: string }>
  consentHistory: Array<{ channel: string; state: string; reason: string | null; source: string; occurredAt: string }>
  scoreEntries: Array<{ points: number; reason: string | null; source: string; occurredAt: string }>
  runs: Array<{
    campaignId: string
    triggerEventId: string
    status: string
    startedAt: string
    completedAt: string | null
    /**
     * What started the run, as it arrived.
     *
     * The one part of a run this module does not define the shape of: an inbound hook puts whatever a
     * partner posted in here, so it is where a name or a phone number about this person actually lives.
     * An export that summarised the run and omitted it answered a subject access request with everything
     * except the part somebody else wrote.
     */
    triggerContext: Record<string, unknown>
  }>
  messages: Array<{ campaignId: string | null; channel: string; status: string; suppressionReason: string | null; sentAt: string }>
  engagement: Array<{ campaignId: string; type: string; linkUrl: string | null; occurredAt: string }>
  /**
   * Added after a review found them missing from both halves.
   *
   * A survey answer is the person's own words — the one thing in this module they actually wrote — so an export
   * without it was the most conspicuous possible omission. The preference, the watches and the referral graph
   * are all things they chose, and all still carried their id after an "erasure".
   */
  surveyAnswers: Array<{ question: string; score: number | null; comment: string | null; askedAt: string; answeredAt: string | null }>
  preference: { maxPerWeek: number | null; pausedUntil: string | null; locale: string | null } | null
  productWatches: Array<{ sku: string; currencyCode: string; watchedPriceGross: string | null; notifiedAt: string | null }>
  referralCode: string | null
  referralsMade: Array<{ status: string; orderTotal: string | null; createdAt: string; convertedAt: string | null }>
  referredBy: { status: string; createdAt: string } | null
  /**
   * Deliveries that failed and were never retried, with the payload that could not be dispatched.
   *
   * Included because the payload is third-party text about this person that the module is holding, and a
   * request to see everything held about somebody does not get to exclude the parts that went wrong.
   */
  undeliveredPayloads: Array<{ source: string; eventId: string | null; payload: Record<string, unknown>; error: string; createdAt: string }>
  /** When this person's marketing data was erased, if it ever was: the only thing erasure writes. */
  erasedAt: string | null
}

/**
 * The subject's own data, in a shape a person can read.
 *
 * Curated rather than dumped: the stored rows carry internal ids, claim tokens and a context blob that
 * mean nothing to the person and would leak how the engine works. What is included is what the data
 * actually SAYS about them — what they consented to, what we scored them, which campaigns they entered,
 * what we sent, and what they did with it.
 */
export async function exportSubjectData(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
  now: Date,
): Promise<SubjectExport> {
  const where = { tenantId: scope.tenantId, organizationId: scope.organizationId, subjectEntityId }

  const [
    consent,
    consentHistory,
    scoreEntries,
    runs,
    messages,
    surveyAnswers,
    preference,
    productWatches,
    referralCode,
    referralsMade,
    referredBy,
    erasure,
    deadLetters,
  ] = await Promise.all([
    em.find(MarketingConsent, where),
    em.find(MarketingConsentEvent, where, { orderBy: { occurredAt: 'DESC' } }),
    em.find(MarketingCustomerScoreEntry, where, { orderBy: { occurredAt: 'DESC' } }),
    em.find(MarketingCampaignRun, where, { orderBy: { startedAt: 'DESC' } }),
    em.find(MarketingMessageSend, where, { orderBy: { sentAt: 'DESC' } }),
    em.find(MarketingSurveyPrompt, where, { orderBy: { askedAt: 'DESC' } }),
    em.findOne(MarketingContactPreference, where),
    em.find(MarketingProductWatch, { ...where, deletedAt: null }, { orderBy: { createdAt: 'DESC' } }),
    em.findOne(MarketingReferralCode, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      referrerEntityId: subjectEntityId,
      deletedAt: null,
    }),
    em.find(MarketingReferralRedemption, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      referrerEntityId: subjectEntityId,
    }, { orderBy: { createdAt: 'DESC' } }),
    em.findOne(MarketingReferralRedemption, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      referredEntityId: subjectEntityId,
    }),
    em.findOne(MarketingSubjectErasure, where),
    /**
     * Matched on the uuid appearing anywhere in the payload, for the same reason erasure is.
     *
     * The subject's id arrives under a different key for every trigger, and a dead letter is the raw
     * payload with no shape this module imposed. A uuid is unique, so the match cannot reach somebody
     * else's row; the null-scope branch covers the dead letters the dispatcher records when it could not
     * resolve a scope, which are the ones most likely to hold an unparsed payload.
     */
    em.find(
      MarketingDispatchDeadLetter,
      {
        $and: [
          { $or: [{ tenantId: scope.tenantId }, { tenantId: null }] },
          { $or: [{ organizationId: scope.organizationId }, { organizationId: null }] },
        ],
      },
      { orderBy: { createdAt: 'DESC' } },
    ).then((rows) => rows.filter((row) => JSON.stringify(row.payload ?? {}).includes(subjectEntityId))),
  ])

  // Engagement is keyed to the send, not the person, so it is reached through this subject's runs — the
  // same indirection the event table was designed around.
  const runIds = runs.map((run) => run.id)
  const engagement = runIds.length
    ? await em.find(MarketingMessageSendEvent, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        runId: { $in: runIds },
      }, { orderBy: { occurredAt: 'DESC' } })
    : []

  return {
    subjectEntityId,
    exportedAt: now.toISOString(),
    consent: consent.map((row) => ({
      channel: row.channel,
      state: row.state,
      reason: row.reason ?? null,
      source: row.source,
      updatedAt: row.updatedAt.toISOString(),
    })),
    consentHistory: consentHistory.map((row) => ({
      channel: row.channel,
      state: row.state,
      reason: row.reason ?? null,
      source: row.source,
      occurredAt: row.occurredAt.toISOString(),
    })),
    scoreEntries: scoreEntries.map((row) => ({
      points: row.points,
      reason: row.reason ?? null,
      source: row.source,
      occurredAt: row.occurredAt.toISOString(),
    })),
    runs: runs.map((row) => ({
      campaignId: row.campaignId,
      triggerEventId: row.triggerEventId,
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      triggerContext: (row.triggerContext ?? {}) as Record<string, unknown>,
    })),
    messages: messages.map((row) => ({
      campaignId: row.campaignId ?? null,
      channel: row.channel,
      status: row.status,
      suppressionReason: row.suppressionReason ?? null,
      sentAt: row.sentAt.toISOString(),
    })),
    engagement: engagement.map((row) => ({
      campaignId: row.campaignId,
      type: row.type,
      linkUrl: row.linkUrl ?? null,
      occurredAt: row.occurredAt.toISOString(),
    })),
    surveyAnswers: surveyAnswers.map((row) => ({
      question: row.question,
      score: row.score ?? null,
      comment: row.comment ?? null,
      askedAt: row.askedAt.toISOString(),
      answeredAt: row.answeredAt ? row.answeredAt.toISOString() : null,
    })),
    preference: preference
      ? {
          maxPerWeek: preference.maxPerWeek ?? null,
          pausedUntil: preference.pausedUntil ? preference.pausedUntil.toISOString() : null,
          locale: preference.locale ?? null,
        }
      : null,
    productWatches: productWatches.map((row) => ({
      sku: row.sku,
      currencyCode: row.currencyCode,
      watchedPriceGross: row.watchedPriceGross ?? null,
      notifiedAt: row.notifiedAt ? row.notifiedAt.toISOString() : null,
    })),
    referralCode: referralCode?.code ?? null,
    referralsMade: referralsMade.map((row) => ({
      status: row.status,
      orderTotal: row.orderTotal ?? null,
      createdAt: row.createdAt.toISOString(),
      convertedAt: row.convertedAt ? row.convertedAt.toISOString() : null,
    })),
    // Who referred THEM is a fact about them, but the other person's id is not theirs to receive.
    referredBy: referredBy ? { status: referredBy.status, createdAt: referredBy.createdAt.toISOString() } : null,
    undeliveredPayloads: deadLetters.map((row) => ({
      source: row.source,
      eventId: row.eventId ?? null,
      payload: row.payload,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
    })),
    erasedAt: erasure ? erasure.erasedAt.toISOString() : null,
  }
}

export type ErasureReport = {
  subjectEntityId: string
  erasedAt: string
  runs: number
  messages: number
  scoreEntries: number
  surveyAnswers: number
  referralRows: number
  /** Deleted rather than unlinked — see the docblock below. */
  preferencesDeleted: number
  productWatchesDeleted: number
  /** Kept on purpose — see the docblock below. */
  consentKept: number
  /** Click URLs blanked, because an interpolated link can carry the address it was built for. */
  linkUrls: number
  /** Dead letters deleted: raw third-party payloads with no replay path and nothing to keep. */
  deadLettersDeleted: number
}

/**
 * Forgets the person while keeping the arithmetic true.
 *
 * **The decision: unlink, do not delete.** The subject link is nulled on every row and the rows stay.
 * Two reasons, and the second is the one that decides it:
 *
 *  1. With the free-form columns handled, a row with no subject id identifies nobody — which is what
 *     erasure has to achieve. This module's own columns were designed to hold no name, address or phone
 *     number, but three places take text it does not control and they are cleared explicitly rather than
 *     assumed empty: the run's `trigger_context` (an inbound hook puts whatever a partner sent in there), a
 *     send event's `link_url` (an author may interpolate `{{customer.email}}` into a link), and a dead
 *     letter's raw payload. The earlier version of this reasoning asserted the columns held nothing
 *     identifying and stopped there, which was true of the schema and not of what goes into it.
 *
 *     `trigger_context` is nulled rather than emptied, and it is a column rather than a jsonb key because it
 *     is encrypted at rest — which is also why this statement no longer touches a `trigger` key inside
 *     `context`: there is not one any more.
 *  2. Deleting them would silently rewrite history. A campaign that reported 4,000 sends last quarter
 *     would start reporting 3,850, and every number an operator wrote down would quietly stop matching.
 *     Erasure is a duty to one person; falsifying an audit trail is a harm to everybody else.
 *
 * **Two tables are DELETED rather than unlinked**, and the same principle is why. A contact preference and a
 * product watch are not history — they are standing instructions ("pause me until March", "tell me when this
 * SKU gets cheaper"). Nothing aggregates over them, so unlinking would preserve no total; it would just leave
 * an instruction with nobody behind it, which is a row that can still cause a message to be composed. An
 * instruction from a person who has asked to be forgotten has to stop existing, not become anonymous.
 *
 * **Consent records are KEPT, with the subject id.** This looks like the opposite of erasure and is the
 * standard, expected practice: forgetting that somebody unsubscribed is how they get mailed again, which
 * is the exact harm they acted to prevent. Once the platform erases the customer row itself, the uuid on
 * the consent record points at nothing and identifies nobody, while still suppressing that id forever.
 */
export async function eraseSubjectData(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
  now: Date,
): Promise<ErasureReport> {
  /**
   * All of it, or none of it.
   *
   * Erasure is nine statements across seven tables and it RETURNS A REPORT that somebody keeps — the answer to
   * a legal request. Without a transaction a failure halfway leaves the person erased from the runs and still
   * named in the survey answers and the referral graph, and the caller gets an error rather than the report, so
   * nothing records how far it got. The next attempt then reports smaller numbers than it actually changed,
   * because the first four statements have nothing left to do.
   *
   * One transaction makes the report true by construction: every number in it describes committed state.
   */
  return em.transactional((tx) => eraseWithin(tx, subjectEntityId, scope, now))
}

async function eraseWithin(
  em: EntityManager,
  subjectEntityId: string,
  scope: SubjectScope,
  now: Date,
): Promise<ErasureReport> {
  const scoped = { tenantId: scope.tenantId, organizationId: scope.organizationId, subjectEntityId }

  /**
   * The free-form columns go first, while the rows still carry the link they are found BY.
   *
   * Everything below nulls `subject_entity_id`, so a statement that needs to locate this person's rows
   * has to run before that happens. Getting the order wrong does not fail — it silently erases nothing.
   */

  /**
   * A click URL is author-written and interpolated, so it can carry the address it was built for.
   *
   * `{{customer.email}}` in a tracked link is a supported thing for an author to write, and the click
   * is recorded with the URL it actually went to. Found through `run_id`, which every send event has,
   * because the sends' own subject link is nulled two statements from here.
   */
  const linkUrls = await em.execute(
    `update marketing_message_send_events
        set link_url = null
      where tenant_id = ? and organization_id = ?
        and link_url is not null
        and run_id in (
          select id from marketing_campaign_runs
           where tenant_id = ? and organization_id = ? and subject_entity_id = ?
        )`,
    [scope.tenantId, scope.organizationId, scope.tenantId, scope.organizationId, subjectEntityId],
  )

  /**
   * Dead letters are deleted outright, which is the one place here that does delete.
   *
   * They hold the RAW platform or partner payload that could not be dispatched — an inbound hook can put
   * a first name, a phone number and anything else a partner chose to send in there, and unlike the run
   * context there is no shape to null one key of. There is also nothing to keep: a dead letter has no
   * replay path, so it is a failed delivery nobody can act on, and the arithmetic no report depends on.
   *
   * Matched on the uuid appearing anywhere in the payload, because the subject's id arrives under a
   * different key for every trigger (`id`, `entityId`, `customerId`, a partner's own spelling). A uuid is
   * unique, so the match cannot catch somebody else's row. The null-scope branch is deliberate: the
   * dispatcher records a dead letter even when it could not resolve a scope, and those are exactly the
   * rows most likely to carry an unparsed payload.
   */
  const deadLettersDeleted = await em.execute(
    `delete from marketing_dispatch_dead_letters
      where (tenant_id = ? or tenant_id is null)
        and (organization_id = ? or organization_id is null)
        and payload::text like ?`,
    [scope.tenantId, scope.organizationId, `%${subjectEntityId}%`],
  )

  const runs = await em.nativeUpdate(MarketingCampaignRun, scoped, { subjectEntityId: null })
  const messages = await em.nativeUpdate(MarketingMessageSend, scoped, { subjectEntityId: null })
  const scoreEntries = await em.nativeUpdate(MarketingCustomerScoreEntry, scoped, { subjectEntityId: null })

  /**
   * The run context carries the subject id as a scalar too.
   *
   * Nulling the column and leaving the jsonb would be erasure in name only — the id would still be there,
   * one key deeper, which is exactly where nobody looks.
   */
  /**
   * `em.execute`, never `em.getConnection().execute` — the difference is the whole erasure.
   *
   * The connection form takes a fresh connection from the pool, so the statement runs OUTSIDE the transaction
   * the caller opened. Two things then go wrong and the second one is fatal. The insert below would be
   * committed on its own, so a failure afterwards would leave a person marked erased whose rows were rolled
   * back — the opposite of what the transaction is for. And this statement writes the very table the
   * transaction has already locked two statements earlier, so it waits for a transaction that is waiting for
   * it: the request hangs until something times out, with no error and nothing erased.
   *
   * It was reproducible on any customer at all, took 40 seconds to say nothing, and the erase button on the
   * customer profile simply never came back. `em.execute` uses the current transaction context.
   */
  await em.execute(
    `update marketing_campaign_runs
        set context = jsonb_set(context, '{subjectEntityId}', 'null'::jsonb),
            trigger_context = null
      where tenant_id = ? and organization_id = ?
        and context ->> 'subjectEntityId' = ?`,
    [scope.tenantId, scope.organizationId, subjectEntityId],
  )

  /**
   * A survey answer keeps its score and loses its words.
   *
   * The score is an aggregate an operator has reported on — an NPS average that changed after an erasure would
   * be the same falsified audit trail the runs and sends avoid. The COMMENT is different: it is free text the
   * person wrote themselves, so it is the one field here that can contain anything at all, including their own
   * name. It goes.
   *
   * This is also the row that made the omission operational rather than paperwork: `set-resolver.ts` narrows
   * audiences on `marketing_survey_prompts.subject_entity_id`, so while the id stayed an erased person was
   * still produced as a candidate for every `survey.nps <= 6` campaign.
   */
  const surveyAnswers = await em.nativeUpdate(MarketingSurveyPrompt, scoped, { subjectEntityId: null, comment: null })

  const preferencesDeleted = await em.nativeDelete(MarketingContactPreference, scoped)
  const productWatchesDeleted = await em.nativeDelete(MarketingProductWatch, scoped)

  /**
   * The referral graph is unlinked from BOTH ends, and the erased person's code is retired with it.
   *
   * Retiring the code is the point: a code is a thing other people type, and one whose owner has been
   * forgotten must stop resolving rather than quietly keep accruing claims for nobody. The redemption rows
   * stay so that the OTHER party's counts — the referrals they made, the rewards they were paid on — do not
   * silently drop by one.
   */
  const referralCodes = await em.nativeUpdate(
    MarketingReferralCode,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, referrerEntityId: subjectEntityId },
    { referrerEntityId: null, deletedAt: now },
  )
  const referralsMade = await em.nativeUpdate(
    MarketingReferralRedemption,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, referrerEntityId: subjectEntityId },
    { referrerEntityId: null },
  )
  const referralsReceived = await em.nativeUpdate(
    MarketingReferralRedemption,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, referredEntityId: subjectEntityId },
    { referredEntityId: null },
  )

  const consentKept = await em.count(MarketingConsent, scoped)

  /**
   * The one thing written rather than removed: that this happened.
   *
   * Everything above unlinks, so afterwards nothing would say the person asked to be forgotten — and score rules,
   * which derive points from the customer record, would start a new ledger for them on the next pass. Idempotent,
   * because a second erasure of the same person is a legitimate request and must not fail on the first one's row.
   */
  // `em.execute` for the reason given above: on the pool this row would commit on its own, and a failure
  // after it would leave somebody recorded as erased with every other change rolled back.
  await em.execute(
    `insert into marketing_subject_erasures (tenant_id, organization_id, subject_entity_id, erased_at)
     values (?, ?, ?, ?)
     on conflict (tenant_id, organization_id, subject_entity_id) do nothing`,
    [scope.tenantId, scope.organizationId, subjectEntityId, now],
  )

  return {
    subjectEntityId,
    erasedAt: now.toISOString(),
    runs,
    messages,
    scoreEntries,
    surveyAnswers,
    referralRows: referralCodes + referralsMade + referralsReceived,
    preferencesDeleted,
    productWatchesDeleted,
    consentKept,
    linkUrls: Number(linkUrls ?? 0),
    deadLettersDeleted: Number(deadLettersDeleted ?? 0),
  }
}

/**
 * Whether this person's marketing data was erased.
 *
 * Asked by everything that would otherwise write about them again — enrolling them in a campaign, a bulk action
 * over a segment — because erasure only unlinks what existed; it cannot stop what comes next unless somebody asks.
 */
export async function isErasedSubject(em: EntityManager, subjectEntityId: string, scope: SubjectScope): Promise<boolean> {
  const rows = await em.getConnection().execute<Array<{ erased: number }>>(
    `select 1 as erased from marketing_subject_erasures
      where subject_entity_id = ? and tenant_id = ? and organization_id = ?
      limit 1`,
    [subjectEntityId, scope.tenantId, scope.organizationId],
  )
  return rows.length > 0
}

/** The tables this module holds subject data in. Exported so the tests can hold both halves to it. */
export const SUBJECT_DATA_TABLES = [
  'marketing_campaign_runs',
  'marketing_message_sends',
  'marketing_message_send_events',
  'marketing_customer_score_entries',
  'marketing_consents',
  'marketing_consent_events',
  'marketing_survey_prompts',
  'marketing_contact_preferences',
  'marketing_product_watches',
  'marketing_referral_codes',
  'marketing_referral_redemptions',
  'marketing_subject_erasures',
] as const
