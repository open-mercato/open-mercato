import type { EntityManager } from '@mikro-orm/postgresql'
import {
  isSuppressedByConsent,
  loadConsentState,
  recordConsent,
  UNRECORDED_CONSENT_ALLOWS_SENDING,
} from '../consent'

const scope = { tenantId: 't1', organizationId: 'o1' }
const now = new Date('2026-09-28T12:00:00.000Z')

function fakeEm(existing: Record<string, unknown> | null = null) {
  const created: Record<string, unknown>[] = []
  const persisted: Record<string, unknown>[] = []
  const queries: Record<string, unknown>[] = []
  let flushes = 0
  const em = {
    findOne: async (_entity: unknown, where: Record<string, unknown>) => {
      queries.push(where)
      return existing
    },
    create: (_entity: unknown, data: Record<string, unknown>) => {
      const row = { ...data }
      created.push(row)
      return row
    },
    persist: (row: Record<string, unknown>) => { persisted.push(row) },
    flush: async () => { flushes += 1 },
  }
  return { em: em as unknown as EntityManager, created, persisted, queries, flushes: () => flushes }
}

describe('consent as a send gate', () => {
  test('an explicit unsubscribe suppresses the channel', async () => {
    const { em } = fakeEm({ state: 'unsubscribed' })
    expect(await isSuppressedByConsent(em, 'c1', scope, 'email')).toBe(true)
  })

  test('an explicit subscribe does not', async () => {
    const { em } = fakeEm({ state: 'subscribed' })
    expect(await isSuppressedByConsent(em, 'c1', scope, 'email')).toBe(false)
  })

  /**
   * The default, stated out loud.
   *
   * Silence means permitted. Treating it as refusal would have disabled every campaign on every existing
   * installation the moment this shipped — a behaviour change delivered as a bug report. An installation
   * that needs opt-in imports its consent, which is what the `import` source is for.
   */
  test('never having said anything is treated as permitted', async () => {
    const { em } = fakeEm(null)
    expect(await isSuppressedByConsent(em, 'c1', scope, 'email')).toBe(false)
    expect(UNRECORDED_CONSENT_ALLOWS_SENDING).toBe(true)
  })

  test('is looked up per channel, scoped', async () => {
    const { em, queries } = fakeEm(null)
    await loadConsentState(em, 'c1', scope, 'sms')
    expect(queries[0]).toEqual({ tenantId: 't1', organizationId: 'o1', subjectEntityId: 'c1', channel: 'sms' })
  })
})

describe('recordConsent', () => {
  test('creates the state and an audit entry together', async () => {
    const { em, created, flushes } = fakeEm(null)
    await recordConsent(em, {
      scope, subjectEntityId: 'c1', channel: 'email', state: 'unsubscribed',
      reason: 'one-click unsubscribe', source: 'customer', campaignId: 'camp-1', now,
    })
    expect(created).toHaveLength(2)
    expect(created[0]).toMatchObject({ subjectEntityId: 'c1', channel: 'email', state: 'unsubscribed', source: 'customer' })
    expect(created[1]).toMatchObject({ state: 'unsubscribed', campaignId: 'camp-1', occurredAt: now })
    expect(flushes()).toBe(1)
  })

  test('updates an existing state rather than inserting a second row', async () => {
    const existing = { state: 'subscribed', reason: null, source: 'operator' }
    const { em, created } = fakeEm(existing)
    await recordConsent(em, {
      scope, subjectEntityId: 'c1', channel: 'email', state: 'unsubscribed', source: 'customer', now,
    })
    expect(existing.state).toBe('unsubscribed')
    expect(existing.source).toBe('customer')
    // Only the audit entry is new: one state row per (customer, channel) is what the gate depends on.
    expect(created).toHaveLength(1)
  })

  // A trail that silently drops repeats cannot answer when a customer actually acted.
  test('records an audit entry even when the answer has not changed', async () => {
    const { em, created } = fakeEm({ state: 'unsubscribed', reason: null, source: 'customer' })
    await recordConsent(em, {
      scope, subjectEntityId: 'c1', channel: 'email', state: 'unsubscribed', source: 'customer', now,
    })
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ state: 'unsubscribed' })
  })

  test('re-subscribing is just another decision', async () => {
    const existing = { state: 'unsubscribed', reason: 'one-click', source: 'customer' }
    const { em } = fakeEm(existing)
    await recordConsent(em, {
      scope, subjectEntityId: 'c1', channel: 'email', state: 'subscribed', source: 'operator',
      reason: 'asked us on the phone', now,
    })
    expect(existing.state).toBe('subscribed')
    expect(existing.reason).toBe('asked us on the phone')
  })
})
