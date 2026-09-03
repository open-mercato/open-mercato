import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config as loadEnv } from 'dotenv'
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { expect, test } from '@playwright/test'
import type { EntityManager } from '@mikro-orm/postgresql'
// Relative, not package-qualified: this spec exercises module internals that the package's
// public surface deliberately does not export, and it lives inside the same package.
import {
  aggregateOmnibusScopes,
  latestHistoryEntryIdsByPrice,
  selectScopeAggregate,
  type OmnibusAggregateScope,
} from '../services/omnibusAggregate'
import type { OmnibusHistoryRow, OmnibusMinimizationAxis } from '../lib/omnibusTypes'

// Match TC-SX-007: when not running under the integration runner (which injects
// DATABASE_URL), load it from apps/mercato/.env so a manual single-spec run works.
if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(process.cwd(), 'apps/mercato', '.env') })
}

/**
 * TC-CAT-039: the Omnibus reference resolves identically in SQL and in memory.
 *
 * The reference price is resolved by one SQL statement in production
 * (`aggregateOmnibusScopes`), because pushing the minimum into the database is what removed the
 * row cap that could silently drop the true minimum (PR #5192 review, finding 2). The unit suite
 * cannot execute a window function against a mocked EntityManager, so it drives
 * `selectScopeAggregate` — an in-memory twin — and that is where the Omnibus rules themselves are
 * pinned: EC-7, the `change_type` filter, the tie-breaks, the baseline instant.
 *
 * Two implementations of a legally-binding calculation are only acceptable while something proves
 * they agree. That proof is this spec, and it lives here rather than in Jest specifically so it
 * runs in CI: the integration runner is the only stage that provides a real PostgreSQL.
 *
 * It talks to `DATABASE_URL` directly, the same way the data_sync and sync_excel specs seed rows
 * the API cannot produce — here because the rows under test are history the write path only
 * creates as a side effect of price mutations, and the cases that matter (ties, NULL axis values,
 * microsecond timestamps) cannot be arranged through the API at all.
 *
 * Fixture lifecycle: `catalog_price_history_entries` is append-only and its trigger raises on
 * DELETE (C12, asserted by TC-CAT-038), so these rows cannot be cleaned up — removing them would
 * mean disabling the guard that is itself under test. Isolation comes from a per-run random
 * `tenant_id` instead: every query in the spec and in the product is tenant-scoped, so the rows are
 * unreachable from any other test or tenant, and the integration database is disposable.
 */

const ORG_ID = '22222222-2222-4222-8222-222222222222'
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333'
const PRICE_KIND_ID = '44444444-4444-4444-8444-444444444444'
const CHANNEL_ID = '55555555-5555-4555-8555-555555555555'

const TENANT_ID = randomUUID()

type Seed = {
  id: string
  priceId: string
  changeType: string
  net: string | null
  gross: string | null
  recordedAt: string
}

const priceUuid = (index: number) => `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`
const at = (dayOffset: number, ms = 0) =>
  new Date(Date.UTC(2026, 4, 1, 0, 0, 0, ms) + dayOffset * 24 * 60 * 60 * 1000).toISOString()

function buildSeeds(): Seed[] {
  const seeds: Seed[] = []
  let index = 0
  const push = (partial: Omit<Seed, 'id' | 'priceId'>) => {
    seeds.push({ id: randomUUID(), priceId: priceUuid(index % 7), ...partial })
    index += 1
  }

  // Several rows sharing one instant, as omnibus:backfill produces — the case that made the
  // reference non-deterministic before the baseline became "the whole instant".
  for (const gross of ['168', '148', '138', '138']) {
    push({ changeType: 'create', net: String(Number(gross) - 10), gross, recordedAt: at(0) })
  }
  // Ties on the axis at different times: the tie-break must pick the older, then the lower id.
  push({ changeType: 'update', net: '90', gross: '100', recordedAt: at(12) })
  push({ changeType: 'update', net: '80', gross: '100', recordedAt: at(12) })
  push({ changeType: 'update', net: '70', gross: '100', recordedAt: at(15) })
  // NULL on one axis only — must never be treated as zero on that axis.
  push({ changeType: 'update', net: null, gross: '95', recordedAt: at(18) })
  push({ changeType: 'update', net: '60', gross: null, recordedAt: at(19) })
  // Withdrawn and undone: cheaper than everything, and must never become the reference.
  push({ changeType: 'delete', net: '1', gross: '1', recordedAt: at(20) })
  push({ changeType: 'undo', net: '2', gross: '2', recordedAt: at(21) })
  // Exactly on the boundaries the CTEs compare against.
  push({ changeType: 'update', net: '55', gross: '65', recordedAt: at(10) })
  push({ changeType: 'update', net: '54', gross: '64', recordedAt: at(30) })
  // Ordinary spread.
  for (let day = 22; day < 29; day += 1) {
    push({ changeType: 'update', net: String(120 + day), gross: String(130 + day), recordedAt: at(day) })
  }
  return seeds
}

function toHistoryRow(seed: Seed): OmnibusHistoryRow {
  return {
    id: seed.id,
    priceId: seed.priceId,
    changeType: seed.changeType,
    // numeric(16,4) comes back scaled; the in-memory twin must compare the same strings the
    // driver returns, or a parity pass would only prove the fixtures agree with themselves.
    unitPriceNet: seed.net === null ? null : Number(seed.net).toFixed(4),
    unitPriceGross: seed.gross === null ? null : Number(seed.gross).toFixed(4),
    recordedAt: new Date(seed.recordedAt).toISOString(),
    startsAt: null,
    offerId: null,
    isAnnounced: null,
  }
}

function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error('[internal] DATABASE_URL is not configured for the Omnibus parity spec')
  return url
}

const seeds = buildSeeds()
const rows = seeds.map(toHistoryRow)

let pool: Pool
let em: EntityManager

const scopeFor = (overrides: Partial<OmnibusAggregateScope>): OmnibusAggregateScope => ({
  key: 'parity',
  offerId: null,
  variantId: null,
  productId: PRODUCT_ID,
  priceKindId: PRICE_KIND_ID,
  currencyCode: 'PLN',
  channelId: CHANNEL_ID,
  windowStart: new Date(at(5)),
  windowEnd: new Date(at(35)),
  anchor: null,
  presented: null,
  ...overrides,
})

const insertEntry = async (params: {
  id: string
  priceId: string
  net: string | null
  gross: string | null
  recordedAt: string
  changeType: string
}) =>
  pool.query(
    `insert into catalog_price_history_entries
       (id, tenant_id, organization_id, price_id, product_id, price_kind_id, price_kind_code,
        currency_code, channel_id, unit_price_net, unit_price_gross, recorded_at, change_type, source)
     values ($1,$2,$3,$4,$5,$6,'regular','PLN',$7,$8,$9,$10::timestamptz,$11,'api')`,
    [
      params.id,
      TENANT_ID,
      ORG_ID,
      params.priceId,
      PRODUCT_ID,
      PRICE_KIND_ID,
      CHANNEL_ID,
      params.net,
      params.gross,
      params.recordedAt,
      params.changeType,
    ],
  )

test.describe('TC-CAT-039: Omnibus aggregate parity — SQL vs in-memory', () => {
  test.beforeAll(async () => {
    pool = new Pool({ connectionString: resolveDatabaseUrl() })
    const db = new Kysely<never>({ dialect: new PostgresDialect({ pool }) })
    em = { getKysely: () => db } as unknown as EntityManager
    for (const seed of seeds) await insertEntry(seed)
  })

  test.afterAll(async () => {
    await pool?.end()
  })

  const cases: Array<{ name: string; scope: OmnibusAggregateScope; axis: OmnibusMinimizationAxis }> = []
  for (const axis of ['gross', 'net'] as const) {
    cases.push({ name: `full window (${axis})`, scope: scopeFor({}), axis })
    cases.push({
      name: `window opening exactly on the shared instant (${axis})`,
      scope: scopeFor({ windowStart: new Date(at(0)) }),
      axis,
    })
    cases.push({
      name: `window with no baseline before it (${axis})`,
      scope: scopeFor({ windowStart: new Date(at(-5)), windowEnd: new Date(at(14)) }),
      axis,
    })
    cases.push({
      name: `anchored window excludes rows at and after the anchor (${axis})`,
      scope: scopeFor({ anchor: new Date(at(20)) }),
      axis,
    })
    cases.push({
      name: `presented reduction excluded by identity — EC-7 (${axis})`,
      scope: scopeFor({ presented: rows.find((row) => row.recordedAt === at(15))! }),
      axis,
    })
    cases.push({
      name: `boundary row exactly at window start (${axis})`,
      scope: scopeFor({ windowStart: new Date(at(10)) }),
      axis,
    })
    cases.push({
      name: `boundary row exactly at window end (${axis})`,
      scope: scopeFor({ windowEnd: new Date(at(30)) }),
      axis,
    })
  }

  for (const entry of cases) {
    test(entry.name, async () => {
      const fromSql = (
        await aggregateOmnibusScopes(em, { tenantId: TENANT_ID, organizationId: ORG_ID }, entry.axis, [entry.scope])
      ).get(entry.scope.key)!
      const fromMemory = selectScopeAggregate(rows, entry.scope, entry.axis)

      // Guard against a vacuous pass: two implementations that both return nothing would satisfy
      // every equality below without proving anything.
      expect(fromMemory.lowest, 'the in-memory twin must resolve a reference for this case').not.toBeNull()
      expect(fromSql.lowest, 'the SQL aggregate must resolve a reference for this case').not.toBeNull()

      // Compare identity and value: picking a different row that happens to carry the same price
      // would still be a divergence, because net and gross must come from one row.
      expect(fromSql.lowest?.id, 'lowest row identity').toBe(fromMemory.lowest?.id)
      expect(fromSql.lowest?.unitPriceGross, 'lowest gross').toBe(fromMemory.lowest?.unitPriceGross)
      expect(fromSql.lowest?.unitPriceNet, 'lowest net').toBe(fromMemory.lowest?.unitPriceNet)
      expect(fromSql.baselineLowest?.id, 'baseline row identity').toBe(fromMemory.baselineLowest?.id)
      expect(fromSql.oldest?.id, 'oldest row identity').toBe(fromMemory.oldest?.id)
    })
  }

  // recorded_at is timestamptz(6). Every write today comes from a JS Date, so the column carries
  // milliseconds — but nothing enforces that, and a row written by SQL (now(), a bulk backfill, a
  // future DB default) would carry microseconds. The mapper truncates to milliseconds on the way
  // into JS, so the in-memory twin compares truncated values while raw SQL would compare full
  // precision: the presented reduction would be excluded in one and kept in the other. Keeping it
  // is an EC-7 violation — the announced promotion becomes its own reference price.
  test('excludes the presented reduction even when recorded_at carries microseconds', async () => {
    const microId = randomUUID()
    const microPriceId = priceUuid(3)
    await insertEntry({
      id: microId,
      priceId: microPriceId,
      net: '5',
      gross: '5',
      recordedAt: '2026-05-20 10:00:00.123456+00',
      changeType: 'update',
    })

    // Exactly what resolvePresentedEntryForPrice hands over: a mapped row, milliseconds only.
    const presented: OmnibusHistoryRow = {
      id: microId,
      priceId: microPriceId,
      changeType: 'update',
      unitPriceNet: '5.0000',
      unitPriceGross: '5.0000',
      recordedAt: new Date('2026-05-20T10:00:00.123Z').toISOString(),
      startsAt: null,
      offerId: null,
      isAnnounced: null,
    }
    const entryScope = scopeFor({ presented })

    const fromSql = (
      await aggregateOmnibusScopes(em, { tenantId: TENANT_ID, organizationId: ORG_ID }, 'gross', [entryScope])
    ).get(entryScope.key)!

    // 5.00 is cheaper than every other fixture, so if the exclusion misses it, it wins outright.
    expect(fromSql.lowest?.id, 'SQL must not let the presented reduction become its own reference').not.toBe(microId)
    expect(
      selectScopeAggregate([...rows, { ...presented }], entryScope, 'gross').lowest?.id,
      'the in-memory twin must exclude it too',
    ).not.toBe(microId)
  })

  test('resolves many scopes in one statement with the same answers as one at a time', async () => {
    const many = cases.slice(0, 5).map((entry, index) => ({ ...entry.scope, key: `scope-${index}` }))
    const batched = await aggregateOmnibusScopes(em, { tenantId: TENANT_ID, organizationId: ORG_ID }, 'gross', many)

    for (const single of many) {
      const alone = (
        await aggregateOmnibusScopes(em, { tenantId: TENANT_ID, organizationId: ORG_ID }, 'gross', [single])
      ).get(single.key)!
      expect(batched.get(single.key)?.lowest?.id, `${single.key} lowest`).toBe(alone.lowest?.id)
      expect(batched.get(single.key)?.baselineLowest?.id, `${single.key} baseline`).toBe(alone.baselineLowest?.id)
      expect(batched.get(single.key)?.oldest?.id, `${single.key} oldest`).toBe(alone.oldest?.id)
    }
  })

  // The products-list batch resolves the presented entry for a whole page with this statement.
  // It has to agree with the per-item read it replaced (`recordedAt DESC, id DESC, limit 1`) row
  // for row, because the presented entry is what EC-7 excludes and what anchors the window: two
  // paths disagreeing here means the grid and the price editor show different reference prices
  // for the same product (M-3).
  //
  // Seeds its own prices rather than reusing the shared fixture: the shared rows are also written
  // to by the microsecond case above, so asserting "the newest row per price" against them would
  // depend on the order tests happen to run in.
  test('returns exactly the newest history row per price, with the same tie-break as the per-item read', async () => {
    const priceA = randomUUID()
    const priceB = randomUUID()
    const older = randomUUID()
    const newest = randomUUID()
    // Two rows sharing the newest instant, which is what omnibus:backfill produces — the winner is
    // decided by the descending id tie-break. The ids are random and then sorted rather than
    // hard-coded: the table is append-only and its fixtures cannot be cleaned up, so a fixed id
    // would collide with its own earlier run on any reused database.
    const [tiedLow, tiedHigh] = [randomUUID(), randomUUID()].sort()

    await insertEntry({ id: older, priceId: priceA, net: '10', gross: '12', recordedAt: at(2), changeType: 'update' })
    await insertEntry({ id: newest, priceId: priceA, net: '11', gross: '13', recordedAt: at(3), changeType: 'update' })
    await insertEntry({ id: tiedLow, priceId: priceB, net: '20', gross: '22', recordedAt: at(4), changeType: 'update' })
    await insertEntry({ id: tiedHigh, priceId: priceB, net: '21', gross: '23', recordedAt: at(4), changeType: 'update' })

    const ids = await latestHistoryEntryIdsByPrice(em, { tenantId: TENANT_ID, organizationId: ORG_ID }, [priceA, priceB])

    // One row per price and no more: this is what bounds the read to the page rather than to the
    // size of the history log.
    expect(ids.length, 'one winning row per price').toBe(2)
    expect([...ids].sort(), 'newest per price, ties broken by descending id').toEqual([newest, tiedHigh].sort())
  })

  // `nulls last` lets a valueless row win when it is the only candidate on its axis. The two
  // implementations must agree to drop it, and not only for parity's sake: an empty
  // `baselineLowest` is what makes computeLowestPrice report `insufficientHistory`, so a SQL side
  // that kept the row would present a history with no usable previous price as a complete one.
  test('drops a baseline whose only rows have no value on the minimisation axis', async () => {
    const scopedProduct = randomUUID()
    const priceId = randomUUID()
    const baselineRow = randomUUID()
    const inWindowRow = randomUUID()

    // Both baseline rows carry gross but no net; the in-window row carries both. Minimising on
    // `net` therefore leaves the baseline with no usable candidate while the window still has one.
    await pool.query(
      `insert into catalog_price_history_entries
         (id, tenant_id, organization_id, price_id, product_id, price_kind_id, price_kind_code,
          currency_code, channel_id, unit_price_net, unit_price_gross, recorded_at, change_type, source)
       values ($1,$2,$3,$4,$5,$6,'regular','PLN',$7,null,'90',$8::timestamptz,'create','api'),
              ($9,$2,$3,$4,$5,$6,'regular','PLN',$7,'70','80',$10::timestamptz,'update','api')`,
      [baselineRow, TENANT_ID, ORG_ID, priceId, scopedProduct, PRICE_KIND_ID, CHANNEL_ID, at(2), inWindowRow, at(20)],
    )

    const entryScope = scopeFor({ productId: scopedProduct, key: 'null-axis-baseline' })
    const rowsForScope: OmnibusHistoryRow[] = [
      {
        id: baselineRow,
        priceId,
        changeType: 'create',
        unitPriceNet: null,
        unitPriceGross: '90.0000',
        recordedAt: new Date(at(2)).toISOString(),
        startsAt: null,
        offerId: null,
        isAnnounced: null,
      },
      {
        id: inWindowRow,
        priceId,
        changeType: 'update',
        unitPriceNet: '70.0000',
        unitPriceGross: '80.0000',
        recordedAt: new Date(at(20)).toISOString(),
        startsAt: null,
        offerId: null,
        isAnnounced: null,
      },
    ]

    const fromSql = (
      await aggregateOmnibusScopes(em, { tenantId: TENANT_ID, organizationId: ORG_ID }, 'net', [entryScope])
    ).get(entryScope.key)!
    const fromMemory = selectScopeAggregate(rowsForScope, entryScope, 'net')

    expect(fromMemory.baselineLowest, 'the in-memory twin drops a valueless baseline').toBeNull()
    expect(fromSql.baselineLowest, 'the SQL aggregate must drop it too').toBeNull()
    // Not a vacuous pass: the window itself still resolves a reference on the same axis.
    expect(fromSql.lowest?.id, 'the in-window row is still the reference').toBe(inWindowRow)
    expect(fromMemory.lowest?.id).toBe(inWindowRow)
  })

  test('returns nothing for an empty price list without touching the database', async () => {
    expect(await latestHistoryEntryIdsByPrice(em, { tenantId: TENANT_ID, organizationId: ORG_ID }, [])).toEqual([])
  })

  test('never reaches across tenants', async () => {
    const priceIds = Array.from(new Set(seeds.map((seed) => seed.priceId)))
    const otherTenant = await latestHistoryEntryIdsByPrice(
      em,
      { tenantId: randomUUID(), organizationId: ORG_ID },
      priceIds,
    )
    expect(otherTenant, 'the same price ids under another tenant must resolve nothing').toEqual([])
  })
})
