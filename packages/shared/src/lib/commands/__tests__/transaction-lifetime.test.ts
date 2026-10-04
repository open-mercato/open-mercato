import type { EntityManager } from '@mikro-orm/postgresql'
import { withAtomicFlush } from '../flush'
import {
  getTransactionLifetime,
  onTransactionLifetimeComplete,
  type TransactionOutcome,
} from '../transaction-lifetime'

function buildEntityManager(): EntityManager {
  return {
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    getUnitOfWork: jest.fn(() => ({
      computeChangeSets: () => undefined,
      getChangeSets: () => [],
    })),
    rollback: jest.fn(async () => undefined),
  } as unknown as EntityManager
}

describe('transaction lifetime', () => {
  it('isolates concurrent transactions that reuse an EntityManager test double', async () => {
    const em = buildEntityManager()
    const lifetimes: object[] = []
    const outcomes: Array<{ label: string; outcome: TransactionOutcome }> = []
    let releaseFirst: (() => void) | undefined
    let markFirstEntered: (() => void) | undefined
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve
    })
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = withAtomicFlush(em, [async () => {
      const lifetime = getTransactionLifetime(em)
      expect(lifetime).not.toBeNull()
      lifetimes.push(lifetime!)
      onTransactionLifetimeComplete(em, (outcome) => {
        outcomes.push({ label: 'first', outcome })
      })
      markFirstEntered!()
      await firstRelease
    }], { transaction: true })

    await firstEntered
    await withAtomicFlush(em, [async () => {
      const lifetime = getTransactionLifetime(em)
      expect(lifetime).not.toBeNull()
      lifetimes.push(lifetime!)
      onTransactionLifetimeComplete(em, (outcome) => {
        outcomes.push({ label: 'second', outcome })
      })
    }], { transaction: true })
    releaseFirst!()
    await first

    expect(lifetimes).toHaveLength(2)
    expect(lifetimes[0]).not.toBe(lifetimes[1])
    expect(outcomes).toEqual([
      { label: 'second', outcome: 'committed' },
      { label: 'first', outcome: 'committed' },
    ])
    expect(getTransactionLifetime(em)).toBeNull()
  })
})
