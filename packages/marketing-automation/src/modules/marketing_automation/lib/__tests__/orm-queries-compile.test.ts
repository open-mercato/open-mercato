import { MikroORM } from '@mikro-orm/postgresql'
import { MarketingCampaignRun } from '../../data/entities'
import { SWEEP_CLAIM_PREFIX } from '../occurrence'

/**
 * The SQL this module's ORM queries actually generate.
 *
 * Written after a query shipped that could never execute. `expireOccurrenceKeys` expressed "not null, and not
 * like this prefix" as `{ $ne: null, $not: { $like: … } }`. MikroORM accepts that and compiles it — into
 * `"occurrence_key" not ?`, which Postgres rejects with `syntax error at or near "not"`. It is the first
 * statement the periodic due-run pass runs, so the whole pass threw once a minute for as long as the module
 * had been installed. Occurrence keys were never released, and a wait whose delayed job was lost was never
 * picked back up.
 *
 * The existing unit test for that function could not have caught it: it fakes `nativeUpdate`, captures the
 * `where` object and asserts its shape, so the ORM never turns that object into SQL. Asserting the arguments
 * were right is not the same as asserting the query is.
 *
 * So this compiles the clause for real — no database needed, `getQuery()` is enough — and asserts the SQL is
 * the shape Postgres accepts. The clause under test is a copy of the production one, and the test above it
 * asserts the copy still matches, so the two cannot drift apart silently.
 */
let orm: MikroORM

beforeAll(async () => {
  orm = await MikroORM.init({
    entities: [MarketingCampaignRun],
    // Never connects: compiling a query is a client-side operation, and the point is to catch the SQL before
    // a database ever sees it.
    dbName: 'compile-only',
    clientUrl: 'postgresql://unused:unused@127.0.0.1:1/compile-only',
    connect: false,
    discovery: { warnWhenNoEntities: false },
  })
})

afterAll(async () => {
  await orm?.close(true)
})

const compile = (where: Record<string, unknown>): string =>
  orm.em.fork().createQueryBuilder(MarketingCampaignRun).update({ occurrenceKey: null }).where(where).getQuery()

describe('the occurrence-key expiry clause', () => {
  const scope = { tenantId: 't1', organizationId: 'o1' }
  const cutoff = new Date('2026-09-30T00:00:00.000Z')

  /** A copy of what `expireOccurrenceKeys` builds. The test below keeps the copy honest. */
  const clause = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    occurrenceKey: { $ne: null },
    $not: { occurrenceKey: { $like: `${SWEEP_CLAIM_PREFIX}%` } },
    startedAt: { $lt: cutoff },
  }

  it('compiles to a negated LIKE, not to a bare operator', () => {
    const sql = compile(clause)
    // What Postgres accepts.
    expect(sql).toContain('not ("occurrence_key" like ?)')
    // What it produced before, and what a syntax error looks like when the ORM has already accepted it.
    expect(sql).not.toMatch(/"occurrence_key"\s+not\s+\?/)
  })

  it('still scopes and still bounds by time', () => {
    const sql = compile(clause)
    expect(sql).toContain('"tenant_id" = ?')
    expect(sql).toContain('"organization_id" = ?')
    expect(sql).toContain('"occurrence_key" is not null')
    expect(sql).toContain('"started_at" < ?')
  })

  it('proves the shape that shipped compiles into something Postgres refuses', () => {
    /**
     * The defect, executable.
     *
     * This is not a hypothetical: `"occurrence_key" not ?` is exactly the text Postgres reported. Keeping it
     * here means the next person who writes `$not` inside a field condition can see, in one line, why the ORM
     * accepting it proves nothing.
     */
    const shipped = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      occurrenceKey: { $ne: null, $not: { $like: `${SWEEP_CLAIM_PREFIX}%` } },
      startedAt: { $lt: cutoff },
    }
    expect(compile(shipped)).toMatch(/"occurrence_key"\s+not\s+\?/)
  })
})

describe('the production clause matches the one under test', () => {
  it('has not drifted from lib/runs.ts', async () => {
    // Read from source rather than duplicated in prose: a copy that quietly stops matching is worse than no
    // copy, because it goes on passing.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(join(__dirname, '..', 'runs.ts'), 'utf8')
    const body = source.slice(source.indexOf('export async function expireOccurrenceKeys'))
    expect(body).toContain('occurrenceKey: { $ne: null }')
    expect(body).toContain('$not: { occurrenceKey: { $like: `${SWEEP_CLAIM_PREFIX}%` } }')
  })
})
