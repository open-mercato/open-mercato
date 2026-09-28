import type { EntityManager } from '@mikro-orm/postgresql'
import { eraseSubjectData, exportSubjectData, SUBJECT_DATA_TABLES } from '../gdpr'

const scope = { tenantId: 't1', organizationId: 'o1' }
const now = new Date('2026-09-28T12:00:00.000Z')
const at = new Date('2026-09-20T10:00:00.000Z')

function fakeEm(rowsByEntity: Record<string, unknown[]> = {}) {
  const finds: Array<{ entity: string; where: Record<string, unknown> }> = []
  const updates: Array<{ entity: string; where: Record<string, unknown>; data: Record<string, unknown> }> = []
  const executed: Array<{ sql: string; params: unknown[] }> = []
  const nameOf = (entity: unknown) => (entity as { name?: string }).name ?? String(entity)

  const em = {
    find: async (entity: unknown, where: Record<string, unknown>) => {
      finds.push({ entity: nameOf(entity), where })
      return rowsByEntity[nameOf(entity)] ?? []
    },
    count: async (entity: unknown) => (rowsByEntity[nameOf(entity)] ?? []).length,
    nativeUpdate: async (entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      updates.push({ entity: nameOf(entity), where, data })
      return (rowsByEntity[nameOf(entity)] ?? []).length
    },
    getConnection: () => ({
      execute: async (sql: string, params: unknown[]) => {
        executed.push({ sql, params })
        return []
      },
    }),
  }
  return { em: em as unknown as EntityManager, finds, updates, executed }
}

describe('exportSubjectData', () => {
  test('covers every table this module keeps subject data in', async () => {
    const { em, finds } = fakeEm({
      MarketingCampaignRun: [{ id: 'r1', campaignId: 'c1', triggerEventId: 'e', status: 'completed', startedAt: at, completedAt: at }],
    })
    await exportSubjectData(em, 'c1', scope, now)
    const queried = new Set(finds.map((entry) => entry.entity))
    for (const entity of ['MarketingConsent', 'MarketingConsentEvent', 'MarketingCustomerScoreEntry', 'MarketingCampaignRun', 'MarketingMessageSend']) {
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
      expect(entry.where).toMatchObject({ tenantId: 't1', organizationId: 'o1', subjectEntityId: 'c1' })
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
  test('unlinks the person from every row rather than deleting the rows', async () => {
    const { em, updates } = fakeEm({
      MarketingCampaignRun: [{}, {}],
      MarketingMessageSend: [{}],
      MarketingCustomerScoreEntry: [{}, {}, {}],
    })
    const report = await eraseSubjectData(em, 'c1', scope, now)

    expect(updates.map((entry) => entry.entity).sort()).toEqual([
      'MarketingCampaignRun', 'MarketingCustomerScoreEntry', 'MarketingMessageSend',
    ])
    for (const entry of updates) {
      expect(entry.data).toEqual({ subjectEntityId: null })
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
    expect(executed).toHaveLength(1)
    expect(executed[0].sql).toContain("jsonb_set(context, '{subjectEntityId}'")
    expect(executed[0].params).toEqual(['t1', 'o1', 'c1'])
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
    ])
  })
})
