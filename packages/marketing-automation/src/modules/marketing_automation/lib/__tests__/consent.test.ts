import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  isSuppressedByConsent,
  loadConsentState,
  recordConsent,
  UNRECORDED_CONSENT_ALLOWS_SENDING,
} from '../consent'

const scope = { tenantId: 't1', organizationId: 'o1' }
const now = new Date('2026-09-28T12:00:00.000Z')

function fakeEm(
  existing: Record<string, unknown> | null = null,
  flushError?: unknown,
  /**
   * The row the race WINNER inserted, visible to the loser's second read.
   *
   * A unique violation means the row exists by definition, so a fake that keeps answering null models a state
   * the database cannot be in — which is how the first version of the retry below looked correct.
   */
  winner?: Record<string, unknown> | null,
) {
  const created: Record<string, unknown>[] = []
  const persisted: Record<string, unknown>[] = []
  const queries: Record<string, unknown>[] = []
  let flushes = 0
  const em = {
    findOne: async (_entity: unknown, where: Record<string, unknown>) => {
      queries.push(where)
      // The first read is the one before the insert; later reads are the loser looking for the winner.
      return queries.length === 1 ? existing : (winner ?? existing)
    },
    create: (_entity: unknown, data: Record<string, unknown>) => {
      const row = { ...data }
      created.push(row)
      return row
    },
    persist: (row: Record<string, unknown>) => { persisted.push(row) },
    // Only the FIRST flush fails: the retry is an update and cannot collide.
    flush: async () => { flushes += 1; if (flushError && flushes === 1) throw flushError },
    clear: () => { /* what the module does after losing an insert race */ },
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

describe('two people unsubscribing at once', () => {
  /**
   * Routine rather than exotic: an RFC 8058 client posts one-click while the person also presses the button on the
   * confirmation page. Both read no row, both insert, one loses the unique index.
   *
   * Answering 500 to somebody who has in fact just been unsubscribed — "you may still be subscribed" — is the
   * single worst thing this module can say, so losing that race reports the decision that is now true.
   */
  test('losing the insert race still reports the decision, and still applies it', async () => {
    /**
     * The earlier handling swallowed the violation on the grounds that the winner "recorded the same
     * decision". That holds when both carry the same state and not otherwise: a one-click `unsubscribed`
     * racing somebody pressing "start receiving them again" are two different answers, and the loser's
     * vanished — state and audit event both — leaving whichever won rather than whichever came last.
     */
    const winner = { state: 'subscribed', reason: null, source: 'operator' }
    const { em, created, flushes } = fakeEm(
      null,
      new UniqueConstraintViolationException(new Error('duplicate key')),
      winner,
    )
    await expect(recordConsent(em, {
      scope, subjectEntityId: 'c1', channel: 'email', state: 'unsubscribed',
      reason: 'one-click', source: 'customer', now,
    })).resolves.toBe('unsubscribed')

    // The loser's decision landed, as an UPDATE on the winner's row — which cannot collide.
    expect(winner).toMatchObject({ state: 'unsubscribed', reason: 'one-click', source: 'customer' })
    // And its audit event was re-appended, so the trail keeps both decisions in arrival order.
    const events = created.filter((row) => row.occurredAt === now)
    expect(events).toHaveLength(2)
    expect(flushes()).toBe(2)
  })

  test('any other failure still throws, because it is not a race', async () => {
    const { em } = fakeEm(null, new Error('connection reset'))
    await expect(recordConsent(em, {
      scope, subjectEntityId: 'c1', channel: 'email', state: 'unsubscribed',
      reason: 'one-click', source: 'customer', now,
    })).rejects.toThrow('connection reset')
  })

  test('an operator can record a decision, and the source says who did', async () => {
    const { em, created } = fakeEm(null)
    await recordConsent(em, {
      scope, subjectEntityId: 'c1', channel: 'email', state: 'unsubscribed',
      reason: 'asked on the phone', source: 'operator', now,
    })
    // "Provably first-party" is a claim somebody may have to substantiate: a decision relayed by staff is a
    // different fact from one the customer entered themselves, and the trail records which.
    for (const row of created) {
      expect(row.source).toBe('operator')
      expect(row.reason).toBe('asked on the phone')
    }
  })
})
