import { findDueRunIds } from '../runs'
import { computeClaimLeaseCutoff } from '../engine/scheduling'
import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * The orphan this scan has to pick back up: `createRun` commits a `running` row, and if the claim
 * that was supposed to follow immediately never lands, nothing else was watching that status before
 * this branch existed — `claimRun`'s unconditional `running` arm would happily take it, but only once
 * something calls it.
 */
const scope = { tenantId: 't1', organizationId: 'o1' }
const now = new Date('2026-09-29T12:00:00.000Z')

function fakeEm() {
  const calls: Array<{ query: Record<string, unknown> }> = []
  const em = {
    find: async (_entity: unknown, query: Record<string, unknown>) => {
      calls.push({ query })
      return []
    },
  }
  return { em: em as unknown as EntityManager, calls }
}

describe('findDueRunIds', () => {
  it('scans stale running rows alongside waiting and claimed ones', async () => {
    const { em, calls } = fakeEm()
    await findDueRunIds(em, scope, now, 200)

    const branches = calls[0].query.$or as Array<Record<string, unknown>>
    const runningBranch = branches.find((branch) => branch.status === 'running')
    expect(runningBranch).toBeDefined()
    expect((runningBranch!.startedAt as { $lt: Date }).$lt.toISOString()).toBe(
      computeClaimLeaseCutoff(now).toISOString(),
    )

    // The existing branches stay exactly as they were.
    expect(branches.some((branch) => branch.status === 'waiting')).toBe(true)
    expect(branches.some((branch) => branch.status === 'claimed')).toBe(true)
  })
})
