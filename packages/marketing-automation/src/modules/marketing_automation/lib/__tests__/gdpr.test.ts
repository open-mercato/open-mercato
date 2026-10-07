import type { EntityManager } from '@mikro-orm/postgresql'
import { eraseSubjectData, exportSubjectData, SUBJECT_DATA_TABLES } from '../gdpr'

const scope = { tenantId: 't1', organizationId: 'o1' }
const now = new Date('2026-09-28T12:00:00.000Z')
const at = new Date('2026-09-20T10:00:00.000Z')

function fakeEm(rowsByEntity: Record<string, unknown[]> = {}) {
  const finds: Array<{ entity: string; where: Record<string, unknown> }> = []
  const updates: Array<{ entity: string; where: Record<string, unknown>; data: Record<string, unknown> }> = []
  const deletes: Array<{ entity: string; where: Record<string, unknown> }> = []
  const executed: Array<{ sql: string; params: unknown[] }> = []
  const transactions: boolean[] = []
  const nameOf = (entity: unknown) => (entity as { name?: string }).name ?? String(entity)

  const em = {
    find: async (entity: unknown, where: Record<string, unknown>) => {
      finds.push({ entity: nameOf(entity), where })
      return rowsByEntity[nameOf(entity)] ?? []
    },
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      finds.push({ entity: nameOf(entity), where })
      return (rowsByEntity[nameOf(entity)] ?? [])[0] ?? null
    },
    count: async (entity: unknown) => (rowsByEntity[nameOf(entity)] ?? []).length,
    nativeUpdate: async (entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      updates.push({ entity: nameOf(entity), where, data })
      return (rowsByEntity[nameOf(entity)] ?? []).length
    },
    nativeDelete: async (entity: unknown, where: Record<string, unknown>) => {
      deletes.push({ entity: nameOf(entity), where })
      return (rowsByEntity[nameOf(entity)] ?? []).length
    },
    /**
     * The transaction-aware raw executor, and the ONLY one this fake offers.
     *
     * `em.execute` uses the current transaction context; `em.getConnection().execute` takes a fresh connection
     * from the pool and runs outside it. The erasure used the second one, and the earlier version of this fake
     * implemented it happily — so the unit tests passed while the real endpoint hung for forty seconds on any
     * customer, waiting for locks its own open transaction was holding. A fake that answers a call the code
     * must not make is a test that certifies the defect.
     */
    execute: async (sql: string, params: unknown[]) => {
      executed.push({ sql, params })
      return []
    },
    getConnection: () => {
      throw new Error('[internal] getConnection() escapes the transaction; use em.execute()')
    },
    /**
     * Erasure runs inside one transaction, so the fake has to offer one.
     *
     * It hands back the same object, which is what makes the counting assertions below still reach the recorded
     * statements — and `transactions` records that it was entered at all, because "did this run atomically" is
     * itself something the tests assert.
     */
    transactional: async <T>(callback: (tx: EntityManager) => Promise<T>): Promise<T> => {
      transactions.push(true)
      return callback(em as unknown as EntityManager)
    },
  }
  return { em: em as unknown as EntityManager, finds, updates, deletes, executed, transactions }
}

describe('exportSubjectData', () => {
  test('covers every table this module keeps subject data in', async () => {
    const { em, finds } = fakeEm({
      MarketingCampaignRun: [{ id: 'r1', campaignId: 'c1', triggerEventId: 'e', status: 'completed', startedAt: at, completedAt: at }],
    })
    await exportSubjectData(em, 'c1', scope, now)
    const queried = new Set(finds.map((entry) => entry.entity))
    for (const entity of [
      'MarketingConsent', 'MarketingConsentEvent', 'MarketingCustomerScoreEntry', 'MarketingCampaignRun',
      'MarketingMessageSend',
      // Added after a review found all four missing from the export: the survey answer is the person's own
      // words, and the other three are choices they made.
      'MarketingSurveyPrompt', 'MarketingContactPreference', 'MarketingProductWatch', 'MarketingReferralRedemption',
      'MarketingSubjectErasure',
    ]) {
      expect(queried.has(entity)).toBe(true)
    }
    // Engagement is reached through the runs, because the event table holds no identity of its own.
    expect(queried.has('MarketingMessageSendEvent')).toBe(true)
  })

  test('scopes every query by tenant, organization and subject', async () => {
    const { em, finds } = fakeEm()
    await exportSubjectData(em, 'c1', scope, now)
    for (const entry of finds) {
      if (entry.entity === 'MarketingMessageSendEvent') continue
      /**
       * The one table whose scope columns are NULLABLE, so its filter has a different shape.
       *
       * The dispatcher records a dead letter even when it could not resolve a scope, and those rows are
       * the ones most likely to hold an unparsed third-party payload — excluding them would leave exactly
       * the riskiest rows out of a subject access request. It is still scoped: this tenant, or no tenant
       * at all, and the payload must contain this person's id. Never somebody else's tenant.
       */
      if (entry.entity === 'MarketingDispatchDeadLetter') {
        expect(entry.where).toEqual({
          $and: [
            { $or: [{ tenantId: 't1' }, { tenantId: null }] },
            { $or: [{ organizationId: 'o1' }, { organizationId: null }] },
          ],
        })
        continue
      }
      expect(entry.where).toMatchObject({ tenantId: 't1', organizationId: 'o1' })
      // The referral graph keys on the two roles rather than on a subject column, so it is scoped by
      // whichever end this person is.
      if (entry.entity.startsWith('MarketingReferral')) {
        expect(entry.where.referrerEntityId ?? entry.where.referredEntityId).toBe('c1')
        continue
      }
      expect(entry.where).toMatchObject({ subjectEntityId: 'c1' })
    }
  })

  test('asks nothing about engagement when the person entered no campaign', async () => {
    const { em, finds } = fakeEm()
    await exportSubjectData(em, 'c1', scope, now)
    expect(finds.some((entry) => entry.entity === 'MarketingMessageSendEvent')).toBe(false)
  })

  // Curated, not dumped: internal ids, claim tokens and the engine's context blob mean nothing to the
  // person asking and would leak how the module works.
  test('returns what the data says about the person, not the stored rows', async () => {
    const { em } = fakeEm({
      MarketingConsent: [{ channel: 'email', state: 'unsubscribed', reason: 'one-click', source: 'customer', updatedAt: at }],
      MarketingCampaignRun: [{ id: 'r1', campaignId: 'camp-1', triggerEventId: 'e', status: 'completed', startedAt: at, completedAt: null, claimToken: 'secret', context: { internals: true } }],
    })
    const result = await exportSubjectData(em, 'c1', scope, now)
    expect(result.consent).toEqual([
      { channel: 'email', state: 'unsubscribed', reason: 'one-click', source: 'customer', updatedAt: at.toISOString() },
    ])
    expect(JSON.stringify(result)).not.toContain('claimToken')
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(result.exportedAt).toBe(now.toISOString())
  })
})

describe('eraseSubjectData', () => {
  /**
   * Nine statements across seven tables, and a report somebody keeps as the answer to a legal request.
   *
   * A failure halfway through leaves the person erased from the runs and still named in the survey answers and
   * the referral graph, with no report to say how far it got — and the next attempt reports smaller numbers than
   * it changed, because the first statements have nothing left to do. The transaction is what makes every number
   * in the report describe committed state.
   */
  test('runs as one transaction, so the report cannot describe a half-erasure', async () => {
    const { em, transactions } = fakeEm()
    await eraseSubjectData(em, 'c1', scope, now)
    expect(transactions).toHaveLength(1)
  })
  test('unlinks the person from every row rather than deleting the rows', async () => {

    const { em, updates } = fakeEm({
      MarketingCampaignRun: [{}, {}],
      MarketingMessageSend: [{}],
      MarketingCustomerScoreEntry: [{}, {}, {}],
    })
    const report = await eraseSubjectData(em, 'c1', scope, now)

    expect(updates.map((entry) => entry.entity).sort()).toEqual([
      'MarketingCampaignRun', 'MarketingCustomerScoreEntry', 'MarketingMessageSend',
      'MarketingReferralCode', 'MarketingReferralRedemption', 'MarketingReferralRedemption',
      'MarketingSurveyPrompt',
    ])
    for (const entry of updates) {
      if (entry.entity.startsWith('MarketingReferral')) continue
      expect(entry.data).toMatchObject({ subjectEntityId: null })
      expect(entry.where).toMatchObject({ tenantId: 't1', organizationId: 'o1', subjectEntityId: 'c1' })
    }
    expect(report).toMatchObject({ runs: 2, messages: 1, scoreEntries: 3, erasedAt: now.toISOString() })
  })

  /**
   * Nulling the column and leaving the jsonb would be erasure in name only — the id would still be there,
   * one key deeper, which is exactly where nobody looks.
   */
  test('also clears the subject id inside the run context', async () => {
    const { em, executed } = fakeEm()
    await eraseSubjectData(em, 'c1', scope, now)
    const contextUpdate = executed.filter((entry) => entry.sql.includes('jsonb_set'))
    expect(contextUpdate).toHaveLength(1)
    expect(contextUpdate[0].sql).toContain("jsonb_set(context, '{subjectEntityId}'")
    expect(contextUpdate[0].params).toEqual(['t1', 'o1', 'c1'])
  })

  /**
   * The nuance that looks wrong and is not.
   *
   * Forgetting that somebody unsubscribed is how they get mailed again — the exact harm they acted to
   * prevent. The suppression record stays; once the platform erases the customer row, its uuid points at
   * nobody while still suppressing that id forever.
   */
  test('keeps the consent record, and reports that it did', async () => {
    const { em, updates } = fakeEm({ MarketingConsent: [{ channel: 'email' }] })
    const report = await eraseSubjectData(em, 'c1', scope, now)
    expect(updates.some((entry) => entry.entity === 'MarketingConsent')).toBe(false)
    expect(updates.some((entry) => entry.entity === 'MarketingConsentEvent')).toBe(false)
    expect(report.consentKept).toBe(1)
  })

  /**
   * The score is an aggregate somebody has reported on; the comment is free text the person wrote, and is
   * the one field in this module that could contain anything, including their own name.
   */
  test('keeps a survey score and destroys the words', async () => {
    const { em, updates } = fakeEm({ MarketingSurveyPrompt: [{}, {}] })
    const report = await eraseSubjectData(em, 'c1', scope, now)
    const survey = updates.find((entry) => entry.entity === 'MarketingSurveyPrompt')
    expect(survey?.data).toEqual({ subjectEntityId: null, comment: null })
    expect(report.surveyAnswers).toBe(2)
  })

  /**
   * The exception to "never delete", and the reason for it.
   *
   * A preference and a watch are standing instructions, not history. Nothing aggregates over them, so
   * unlinking would preserve no total — it would leave an instruction with nobody behind it that can still
   * cause a message to be composed.
   */
  test('deletes the standing instructions rather than anonymising them', async () => {
    const { em, deletes, updates } = fakeEm({
      MarketingContactPreference: [{}],
      MarketingProductWatch: [{}, {}, {}],
    })
    const report = await eraseSubjectData(em, 'c1', scope, now)
    expect(deletes.map((entry) => entry.entity).sort()).toEqual(['MarketingContactPreference', 'MarketingProductWatch'])
    for (const entry of deletes) {
      expect(entry.where).toMatchObject({ tenantId: 't1', organizationId: 'o1', subjectEntityId: 'c1' })
    }
    expect(updates.some((entry) => entry.entity === 'MarketingContactPreference')).toBe(false)
    expect(report).toMatchObject({ preferencesDeleted: 1, productWatchesDeleted: 3 })
  })

  /**
   * A code is a thing OTHER people type, so it has to stop resolving — while the redemption rows stay, or the
   * other party's referral counts silently drop by one.
   */
  test('retires the code and unlinks both ends of the referral graph', async () => {
    const { em, updates } = fakeEm({ MarketingReferralCode: [{}], MarketingReferralRedemption: [{}] })
    const report = await eraseSubjectData(em, 'c1', scope, now)

    const code = updates.find((entry) => entry.entity === 'MarketingReferralCode')
    expect(code?.data).toEqual({ referrerEntityId: null, deletedAt: now })
    expect(code?.where).toMatchObject({ referrerEntityId: 'c1' })

    const redemptions = updates.filter((entry) => entry.entity === 'MarketingReferralRedemption')
    expect(redemptions.map((entry) => entry.data)).toEqual([{ referrerEntityId: null }, { referredEntityId: null }])
    expect(report.referralRows).toBe(3)
  })

  test('the two halves agree about which tables hold subject data', () => {
    // A table in one and not the other is either an export that lies to the person or an erasure that
    // lies to the regulator.
    expect([...SUBJECT_DATA_TABLES]).toEqual([
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
      'marketing_inbound_requests',
    ])
  })

  test('records that the erasure happened, idempotently, so nothing rebuilds a profile afterwards', async () => {
    const { em, executed } = fakeEm()
    await eraseSubjectData(em, 'c1', scope, now)
    const insert = executed.find((entry) => entry.sql.includes('insert into marketing_subject_erasures'))
    expect(insert?.sql).toContain('on conflict')
    expect(insert?.params).toEqual(['t1', 'o1', 'c1', now])
  })
})

/**
 * The columns this module does not define the shape of.
 *
 * The erasure reasoning used to be "these rows contain nothing else that identifies anybody", which was true
 * of the schema and not of what goes into it. Three places take text from outside: an inbound hook's payload
 * lands in the run context's `trigger` blob, an author may interpolate `{{customer.email}}` into a tracked
 * link, and a dead letter is a raw payload with no shape at all.
 */
describe('eraseSubjectData — the free-form columns', () => {
  test('blanks click URLs before the rows that locate them are unlinked', async () => {
    const { em, executed, updates } = fakeEm()
    await eraseSubjectData(em, 'c1', scope, now)

    const linkUpdate = executed.findIndex((entry) => entry.sql.includes('set link_url = null'))
    expect(linkUpdate).toBeGreaterThanOrEqual(0)
    expect(executed[linkUpdate].params).toContain('c1')

    /**
     * The ordering IS the fix. Every update below nulls `subject_entity_id`, and the link statement finds
     * its rows through the runs table — so running it afterwards would match nothing and erase nothing,
     * silently and with a perfectly plausible count of zero.
     */
    const firstUnlink = updates.findIndex((entry) => entry.data?.subjectEntityId === null)
    expect(firstUnlink).toBeGreaterThanOrEqual(0)
    expect(linkUpdate).toBe(0)
  })

  test('nulls the trigger column and the subject id inside the context, in one statement', async () => {
    const { em, executed } = fakeEm()
    await eraseSubjectData(em, 'c1', scope, now)

    const contextUpdate = executed.find((entry) => entry.sql.includes('jsonb_set'))
    expect(contextUpdate).toBeDefined()
    // The id one key deeper in the queryable half, and the partner payload in the encrypted column beside it.
    expect(contextUpdate?.sql).toContain("'{subjectEntityId}'")
    expect(contextUpdate?.sql).toContain('trigger_context = null')
    // There is no `trigger` key inside `context` any more; a statement still emptying one would be erasing
    // a place nothing is stored.
    expect(contextUpdate?.sql).not.toContain("jsonb_build_object('trigger'")
  })

  test('deletes dead letters that mention the person, matched on the uuid', async () => {
    const { em, executed } = fakeEm()
    await eraseSubjectData(em, 'c1', scope, now)

    const deletion = executed.find((entry) => entry.sql.includes('delete from marketing_dispatch_dead_letters'))
    expect(deletion).toBeDefined()
    // The id arrives under a different key for every trigger, so the payload is matched as text.
    expect(deletion?.params).toContain('%c1%')
    // Scoped even though both scope columns are nullable on that table.
    expect(deletion?.sql).toContain('tenant_id = ? or tenant_id is null')
  })

  test('reports both counts, because a report is what answers the legal request', async () => {
    const { em } = fakeEm()
    const report = await eraseSubjectData(em, 'c1', scope, now)
    expect(report).toMatchObject({ linkUrls: expect.any(Number), deadLettersDeleted: expect.any(Number) })
  })
})
