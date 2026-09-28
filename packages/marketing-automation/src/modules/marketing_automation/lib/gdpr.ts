import type { EntityManager } from '@mikro-orm/postgresql'
import {
  MarketingCampaignRun,
  MarketingConsent,
  MarketingConsentEvent,
  MarketingCustomerScoreEntry,
  MarketingMessageSend,
  MarketingMessageSendEvent,
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
  runs: Array<{ campaignId: string; triggerEventId: string; status: string; startedAt: string; completedAt: string | null }>
  messages: Array<{ campaignId: string | null; channel: string; status: string; suppressionReason: string | null; sentAt: string }>
  engagement: Array<{ campaignId: string; type: string; linkUrl: string | null; occurredAt: string }>
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

  const [consent, consentHistory, scoreEntries, runs, messages] = await Promise.all([
    em.find(MarketingConsent, where),
    em.find(MarketingConsentEvent, where, { orderBy: { occurredAt: 'DESC' } }),
    em.find(MarketingCustomerScoreEntry, where, { orderBy: { occurredAt: 'DESC' } }),
    em.find(MarketingCampaignRun, where, { orderBy: { startedAt: 'DESC' } }),
    em.find(MarketingMessageSend, where, { orderBy: { sentAt: 'DESC' } }),
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
  }
}

export type ErasureReport = {
  subjectEntityId: string
  erasedAt: string
  runs: number
  messages: number
  scoreEntries: number
  /** Kept on purpose — see the docblock below. */
  consentKept: number
}

/**
 * Forgets the person while keeping the arithmetic true.
 *
 * **The decision: unlink, do not delete.** The subject link is nulled on every row and the rows stay.
 * Two reasons, and the second is the one that decides it:
 *
 *  1. These rows contain nothing else that identifies anybody. This module never stored a name, an address
 *     or a phone number — the run context, the send history and the event table were each designed to hold
 *     none — so a row with no subject id identifies nobody, which is what erasure has to achieve.
 *  2. Deleting them would silently rewrite history. A campaign that reported 4,000 sends last quarter
 *     would start reporting 3,850, and every number an operator wrote down would quietly stop matching.
 *     Erasure is a duty to one person; falsifying an audit trail is a harm to everybody else.
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
  const scoped = { tenantId: scope.tenantId, organizationId: scope.organizationId, subjectEntityId }

  const runs = await em.nativeUpdate(MarketingCampaignRun, scoped, { subjectEntityId: null })
  const messages = await em.nativeUpdate(MarketingMessageSend, scoped, { subjectEntityId: null })
  const scoreEntries = await em.nativeUpdate(MarketingCustomerScoreEntry, scoped, { subjectEntityId: null })

  /**
   * The run context carries the subject id as a scalar too.
   *
   * Nulling the column and leaving the jsonb would be erasure in name only — the id would still be there,
   * one key deeper, which is exactly where nobody looks.
   */
  await em.getConnection().execute(
    `update marketing_campaign_runs
        set context = jsonb_set(context, '{subjectEntityId}', 'null'::jsonb)
      where tenant_id = ? and organization_id = ?
        and context ->> 'subjectEntityId' = ?`,
    [scope.tenantId, scope.organizationId, subjectEntityId],
  )

  const consentKept = await em.count(MarketingConsent, scoped)

  return {
    subjectEntityId,
    erasedAt: now.toISOString(),
    runs,
    messages,
    scoreEntries,
    consentKept,
  }
}

/** The tables this module holds subject data in. Exported so the tests can hold both halves to it. */
export const SUBJECT_DATA_TABLES = [
  'marketing_campaign_runs',
  'marketing_message_sends',
  'marketing_message_send_events',
  'marketing_customer_score_entries',
  'marketing_consents',
  'marketing_consent_events',
] as const
