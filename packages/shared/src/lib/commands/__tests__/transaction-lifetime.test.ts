import type { EntityManager } from '@mikro-orm/postgresql'
import { withAtomicFlush } from '../flush'
import {
  getTransactionLifetime,
  onTransactionLifetimeComplete,
  type TransactionOutcome,
} from '../transaction-lifetime'
import { registerTelemetryRuntime, type TelemetryRuntime } from '../../telemetry/runtime'

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

  it('runs every completion callback after commit and reports failures without rejecting the committed flush', async () => {
    const em = buildEntityManager()
    const reportError = jest.fn()
    const unregister = registerTelemetryRuntime({ reportError } as unknown as TelemetryRuntime)
    const calls: string[] = []
    const failure = new Error('post-commit callback failed')

    try {
      await expect(withAtomicFlush(em, [async () => {
        onTransactionLifetimeComplete(em, () => {
          calls.push('first')
          throw failure
        })
        onTransactionLifetimeComplete(em, async (outcome) => {
          calls.push(`second:${outcome}`)
        })
      }], { transaction: true })).resolves.toBeUndefined()
    } finally {
      unregister()
    }

    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['first', 'second:committed'])
    expect(reportError).toHaveBeenCalledWith(failure, expect.objectContaining({
      code: 'shared.transaction_completion_callback_failed',
      attributes: { outcome: 'committed' },
    }))
    expect(getTransactionLifetime(em)).toBeNull()
  })

  it('never lets a rollback completion callback mask the original error', async () => {
    const em = buildEntityManager()
    const original = new Error('phase failed')
    const outcomes: TransactionOutcome[] = []

    await expect(withAtomicFlush(em, [async () => {
      onTransactionLifetimeComplete(em, async () => {
        throw new Error('rollback callback failed')
      })
      onTransactionLifetimeComplete(em, (outcome) => {
        outcomes.push(outcome)
      })
      throw original
    }], { transaction: true })).rejects.toBe(original)

    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(outcomes).toEqual(['rolled_back'])
    expect(getTransactionLifetime(em)).toBeNull()
  })
})
