import { failRun } from '../runs'
import { computeNextRetryAt, hasExhaustedAttempts, MAX_ATTEMPTS } from '../engine/scheduling'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AutomationContext } from '../engine/types'

/**
 * What a failed run reports back, and why it has to report the retry instant rather than store it and hope.
 *
 * Nothing covered this function, which is exactly how the exponential backoff came to be silently discarded: the
 * caller re-read `resumeAt` with a primary-key lookup, MikroORM served it from the identity map — which
 * `nativeUpdate` never touches — and the stale instant produced a delay of zero. The retry was then enqueued
 * immediately, refused by `claimRun`, and the only thing that ever retried a run was the sweep.
 */
const scope = { tenantId: 't1', organizationId: 'o1' }
const now = new Date('2026-09-29T12:00:00.000Z')

function fakeEm() {
  const updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = []
  const em = {
    nativeUpdate: async (_entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      updates.push({ where, data })
      return 1
    },
  }
  return { em: em as unknown as EntityManager, updates }
}

const input = (attempts: number) => ({
  attempts,
  error: new Error('[internal] the transport refused'),
  stepLog: [],
  resumeStepIndex: 2,
  context: { tenantId: 't1', organizationId: 'o1', eventId: 'x', occurredAt: now.toISOString(), dispatchDepth: 1 } as AutomationContext,
})

describe('failRun', () => {
  test('answers with the instant the retry is due, so the caller need not read it back', async () => {
    const { em } = fakeEm()
    const outcome = await failRun(em, 'run-1', scope, 'token', input(0), now)
    expect(outcome.status).toBe('retrying')
    // The same instant the write stored: one source, no second read that could be served stale.
    expect(outcome.resumeAt?.toISOString()).toBe(computeNextRetryAt(1, now).toISOString())
  })

  test('the delay grows with the attempts, which is the whole point of a backoff', async () => {
    const first = await failRun(fakeEm().em, 'run-1', scope, 'token', input(0), now)
    const third = await failRun(fakeEm().em, 'run-1', scope, 'token', input(2), now)
    expect(third.resumeAt!.getTime()).toBeGreaterThan(first.resumeAt!.getTime())
  })

  test('the stored instant and the reported one are the same value', async () => {
    const { em, updates } = fakeEm()
    const outcome = await failRun(em, 'run-1', scope, 'token', input(1), now)
    expect((updates[0].data.resumeAt as Date).toISOString()).toBe(outcome.resumeAt?.toISOString())
  })

  test('a run out of attempts is dead, with nothing to retry', async () => {
    const { em, updates } = fakeEm()
    const outcome = await failRun(em, 'run-1', scope, 'token', input(MAX_ATTEMPTS), now)
    expect(hasExhaustedAttempts(MAX_ATTEMPTS + 1)).toBe(true)
    expect(outcome).toEqual({ status: 'dead', resumeAt: null })
    expect(updates[0].data.status).toBe('dead')
  })

  test('the write is fenced by the claim token, so a lost lease cannot overwrite', async () => {
    const { em, updates } = fakeEm()
    await failRun(em, 'run-1', scope, 'token-abc', input(0), now)
    expect(updates[0].where).toMatchObject({ id: 'run-1', claimToken: 'token-abc', ...scope })
  })

  test('the error text is stored redacted, because a rejection quotes the address', async () => {
    const { em, updates } = fakeEm()
    await failRun(em, 'run-1', scope, 'token', {
      ...input(0),
      error: new Error('550 5.1.1 <someone@example.com> rejected'),
    }, now)
    expect(String(updates[0].data.lastError)).not.toContain('someone@example.com')
  })
})
