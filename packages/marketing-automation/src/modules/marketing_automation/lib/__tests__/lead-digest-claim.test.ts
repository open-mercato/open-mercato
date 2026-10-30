import { leadDigestIsDue, DIGEST_JOB_KIND } from '../lead-digest'
import { buildRepDigests, MAX_DIGEST_LEADS_PER_REP } from '../lead-routing'
import type { EntityManager } from '@mikro-orm/postgresql'

const scope = { tenantId: 't1', organizationId: 'o1' }
const now = new Date('2026-10-02T12:00:00.000Z')

/**
 * The job row is the claim, so a row that is still `running` already answers "somebody is on it".
 *
 * The digest used to send first and record afterwards, which made the record a receipt rather than a claim:
 * two overlapping ticks both read "not sent this week" and both sent, and the longer the send loop ran the
 * wider that window was.
 */
describe('leadDigestIsDue', () => {
  function fakeEm(rows: unknown[]) {
    const queries: Array<Record<string, unknown>> = []
    const em = {
      find: async (_entity: unknown, where: Record<string, unknown>) => {
        queries.push(where)
        return rows
      },
    }
    return { em: em as unknown as EntityManager, queries }
  }

  test('due when the log holds nothing for this week', async () => {
    const { em } = fakeEm([])
    await expect(leadDigestIsDue(em, scope, now)).resolves.toBe(true)
  })

  test('not due once a row exists, whatever its status', async () => {
    const { em, queries } = fakeEm([{ id: 'job-1', status: 'running' }])
    await expect(leadDigestIsDue(em, scope, now)).resolves.toBe(false)
    // Status is deliberately not filtered: a running row is the claim.
    expect(queries[0]).toMatchObject({ kind: DIGEST_JOB_KIND, tenantId: 't1', organizationId: 'o1' })
    expect(Object.keys(queries[0])).not.toContain('status')
  })
})

/**
 * One rep's digest is not something a colleague can take.
 *
 * It used to be one query over the whole pool with a shared ceiling of 200, ordered by creation — so the
 * busiest rep's newest leads filled the budget and every quiet rep got an empty digest, which is then
 * dropped as not worth sending. They were told nothing, and nothing said why.
 */
describe('buildRepDigests — the per-rep ceiling', () => {
  test('asks per rep, each with its own limit', async () => {
    const asked: Array<{ owner: unknown; limit: unknown }> = []
    const em = {
      find: async () => [],
      count: async () => 0,
      getConnection: () => ({ execute: async () => [] }),
      findOne: async () => null,
    } as unknown as EntityManager

    jest.spyOn(await import('@open-mercato/shared/lib/encryption/find'), 'findWithDecryption')
      .mockImplementation((async (_em: unknown, _entity: unknown, where: Record<string, unknown>, options: Record<string, unknown>) => {
        asked.push({ owner: where.ownerUserId, limit: options.limit })
        return []
      }) as never)

    await buildRepDigests(em, scope, ['rep-a', 'rep-b'], new Date(now.getTime() - 7 * 86_400_000))

    expect(asked.map((entry) => entry.owner)).toEqual(['rep-a', 'rep-b'])
    // Never `$in` over the pool with one shared budget.
    expect(asked.every((entry) => entry.limit === MAX_DIGEST_LEADS_PER_REP)).toBe(true)
    jest.restoreAllMocks()
  })
})
