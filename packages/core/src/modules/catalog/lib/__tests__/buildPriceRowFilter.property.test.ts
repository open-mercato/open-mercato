import { buildPriceRowFilter, selectBestPrice, type PriceRow, type PricingContext } from '../pricing'

/**
 * Property-based soundness check for `buildPriceRowFilter`.
 *
 * `.ai/specs/2026-08-21-pricing-engine.md` § Row narrowing calls for this to
 * be verified as "a property-based test, not a fixture table" via a harness
 * (`fast-check`) that turned out not to exist anywhere in this repo — that
 * sibling spec is itself unimplemented (see the spec's own Changelog entry
 * for this correction). Rather than pull in a new devDependency to satisfy a
 * different, unimplemented spec, this hand-rolls the same style of check: a
 * seeded pseudo-random generation loop over many `(row, context)` pairs,
 * asserting the one invariant that matters —
 *
 *   matchesContext(row, ctx) ⇒ buildPriceRowFilter(ctx) admits row
 *
 * `matchesContext` itself is private to `lib/pricing.ts`; `selectBestPrice`
 * is its already-public proxy — for a single-row input, `selectBestPrice`
 * returns non-null exactly when that one row passed `matchesContext`, with
 * no tie-break ambiguity to muddy the signal.
 */

// Mulberry32 — tiny, dependency-free, deterministic PRNG. A fixed seed keeps
// this test's failures reproducible without needing a real property-testing
// library's shrink/replay machinery.
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEED = 20260919
const ITERATIONS = 2000

type Dimension = 'customerId' | 'customerGroupId' | 'userId' | 'userGroupId' | 'channelId' | 'currencyCode'
const DIMENSIONS: Dimension[] = ['customerId', 'customerGroupId', 'userId', 'userGroupId', 'channelId', 'currencyCode']
// Deliberately overlapping value pools per dimension: real matches happen
// only when random draws coincide, alongside plenty of mismatches and nulls.
const VALUE_POOL = ['a', 'b', 'c'] as const
const PRICE_KIND_POOL = ['pk-regular', 'pk-wholesale', 'pk-sale'] as const
const PROMOTIONAL_PRICE_KINDS = new Set<string>(['pk-sale'])

function pick<T>(rng: () => number, options: readonly T[]): T {
  return options[Math.floor(rng() * options.length)]
}

function maybe<T>(rng: () => number, value: T, probability = 0.5): T | undefined {
  return rng() < probability ? value : undefined
}

function randomPriceKind(rng: () => number): unknown {
  const shape = rng()
  const id = pick(rng, PRICE_KIND_POOL)
  if (shape < 0.45) return { id, code: id.replace('pk-', ''), isPromotion: PROMOTIONAL_PRICE_KINDS.has(id) }
  if (shape < 0.9) return id
  return null
}

function randomRow(rng: () => number, id: string): PriceRow {
  const row: Record<string, unknown> = {
    id,
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    currencyCode: maybe(rng, pick(rng, VALUE_POOL)) ?? 'USD',
    kind: 'regular',
    priceKind: randomPriceKind(rng),
    minQuantity: 1,
    unitPriceNet: '10.00',
    unitPriceGross: '12.30',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  }
  for (const dimension of DIMENSIONS) {
    if (dimension === 'currencyCode') continue
    row[dimension] = maybe(rng, pick(rng, VALUE_POOL)) ?? null
  }
  return row as unknown as PriceRow
}

function randomContext(rng: () => number): PricingContext {
  const ctx: Record<string, unknown> = { quantity: 1, date: new Date('2024-02-01T00:00:00Z') }
  for (const dimension of DIMENSIONS) {
    if (dimension === 'customerGroupId' || dimension === 'customerId') continue
    ctx[dimension] = maybe(rng, pick(rng, VALUE_POOL)) ?? null
  }
  // Customer scope: absent, legacy customerId only, or a customerIds set of
  // 0, 1, or 2 ids (person first, then company).
  const customerMode = rng()
  if (customerMode < 0.25) {
    ctx.customerId = maybe(rng, pick(rng, VALUE_POOL)) ?? null
  } else if (customerMode < 0.8) {
    const count = Math.floor(rng() * 3)
    ctx.customerIds = Array.from({ length: count }, () => pick(rng, VALUE_POOL))
  }
  const kindMode = rng()
  if (kindMode < 0.4) ctx.priceKindId = pick(rng, PRICE_KIND_POOL)
  else if (kindMode < 0.7) ctx.priceKindId = null
  // Randomly exercise both the legacy customerGroupId shape and the new
  // customerGroupIds set shape (never both — matches real caller usage).
  const groupMode = rng()
  if (groupMode < 0.34) {
    ctx.customerGroupId = maybe(rng, pick(rng, VALUE_POOL)) ?? null
  } else if (groupMode < 0.67) {
    const count = Math.floor(rng() * 3)
    ctx.customerGroupIds = Array.from({ length: count }, () => pick(rng, VALUE_POOL))
  }
  return ctx as unknown as PricingContext
}

// Minimal interpreter for exactly the filter shapes `buildPriceRowFilter`
// emits ($and of {field: null} / {field: value} / {$or: [...]} /
// {field: {$in: [...]}} / {relation: {property: value}}) — not a general
// MikroORM query evaluator. A relation clause against an unpopulated id
// string evaluates as not admitted: the interpreter cannot see the joined
// row, so this keeps the check conservative (the database would join and
// may admit more, which only widens the fetch).
function admits(filter: unknown, row: Record<string, unknown>): boolean {
  const node = filter as Record<string, unknown>
  if (Array.isArray(node.$and)) {
    return (node.$and as unknown[]).every((clause) => admits(clause, row))
  }
  if (Array.isArray(node.$or)) {
    return (node.$or as unknown[]).some((clause) => admits(clause, row))
  }
  return Object.entries(node).every(([field, expected]) => {
    const raw = row[field] ?? null
    const actual =
      raw && typeof raw === 'object' && 'id' in (raw as Record<string, unknown>) ? (raw as { id: unknown }).id : raw
    if (expected === null) return actual === null
    if (expected && typeof expected === 'object' && '$in' in (expected as Record<string, unknown>)) {
      const list = (expected as { $in: unknown[] }).$in
      return actual !== null && list.includes(actual)
    }
    if (expected && typeof expected === 'object') {
      if (!raw || typeof raw !== 'object') return false
      return Object.entries(expected as Record<string, unknown>).every(
        ([property, value]) => (raw as Record<string, unknown>)[property] === value,
      )
    }
    return actual === expected
  })
}

describe('buildPriceRowFilter soundness (property-based)', () => {
  it(`admits every row matchesContext would accept, over ${ITERATIONS} generated (row, context) pairs`, () => {
    const rng = mulberry32(SEED)
    let acceptedByMatcher = 0
    let acceptedPromotionOverlay = 0

    for (let i = 0; i < ITERATIONS; i += 1) {
      const row = randomRow(rng, `row-${i}`)
      const ctx = randomContext(rng)

      const matcherAccepted = selectBestPrice([row], ctx) !== null
      if (matcherAccepted) {
        acceptedByMatcher += 1
        const rowKind = row.priceKind && typeof row.priceKind === 'object' ? row.priceKind : null
        if (ctx.priceKindId && rowKind?.isPromotion && rowKind.id !== ctx.priceKindId) acceptedPromotionOverlay += 1
        const filterAdmits = admits(buildPriceRowFilter(ctx), row as unknown as Record<string, unknown>)
        if (!filterAdmits) {
          throw new Error(
            `Soundness violation at iteration ${i}: matchesContext accepted the row but ` +
              `buildPriceRowFilter would have excluded it.\nrow=${JSON.stringify(row)}\nctx=${JSON.stringify(ctx)}`,
          )
        }
      }
    }

    // A generation scheme that never produces an accepted pair would make
    // the loop above vacuously true — guard against that regressing silently.
    expect(acceptedByMatcher).toBeGreaterThan(0)
    expect(acceptedPromotionOverlay).toBeGreaterThan(0)
  })

  it('selectBestPrice resolves identically over the full row set and the buildPriceRowFilter-narrowed set', () => {
    // Mirrors the scaling scenario the spec's Row narrowing section names:
    // one product, several unrelated contract rows for OTHER customers, one
    // fallback regular row. `buildPriceRowFilter` is the predicate a real
    // caller would push into the DB query; applying it here (via the same
    // interpreter as the soundness test above) simulates that narrowed fetch
    // without needing a live database. Only `customerId` varies across rows
    // — every other scope dimension stays null, so the scenario isolates
    // exactly the "many unrelated contract rows" case, undiluted by
    // unrelated random scope collisions.
    const scopedRow = (id: string, customerId: string | null): PriceRow =>
      ({
        id,
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        currencyCode: 'USD',
        kind: 'regular',
        priceKind: { id: 'pk-regular', code: 'regular', isPromotion: false },
        minQuantity: 1,
        unitPriceNet: '10.00',
        unitPriceGross: '12.30',
        customerId,
        customerGroupId: null,
        userId: null,
        userGroupId: null,
        channelId: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      }) as unknown as PriceRow

    const fallback = scopedRow('fallback', null)
    const otherContracts = ['cust-x', 'cust-y', 'cust-z'].map((customerId) => scopedRow(`contract-${customerId}`, customerId))
    const myContract = scopedRow('contract-cust-a', 'cust-a')

    const fullSet: PriceRow[] = [fallback, ...otherContracts, myContract]
    const narrow = (ctx: PricingContext) =>
      fullSet.filter((row) => admits(buildPriceRowFilter(ctx), row as unknown as Record<string, unknown>))

    // Buyer with a contract row: both sets resolve to that specific row.
    const buyerWithContract: PricingContext = { quantity: 1, date: new Date('2024-02-01T00:00:00Z'), customerId: 'cust-a' }
    const fullResultWithContract = selectBestPrice(fullSet, buyerWithContract)
    const narrowedResultWithContract = selectBestPrice(narrow(buyerWithContract), buyerWithContract)
    expect(fullResultWithContract?.id).toBe('contract-cust-a')
    expect(narrowedResultWithContract?.id).toBe(fullResultWithContract?.id)

    // Buyer with no contract: both sets fall back to the same unscoped row.
    const buyerWithoutContract: PricingContext = { quantity: 1, date: new Date('2024-02-01T00:00:00Z') }
    const fullResultNoContract = selectBestPrice(fullSet, buyerWithoutContract)
    const narrowedResultNoContract = selectBestPrice(narrow(buyerWithoutContract), buyerWithoutContract)
    expect(fullResultNoContract?.id).toBe('fallback')
    expect(narrowedResultNoContract?.id).toBe(fullResultNoContract?.id)

    // Buyer resolved as a person and a company, both with contract rows: the
    // person row wins the equal-score tie-break in both sets.
    const personAndCompany: PricingContext = {
      quantity: 1,
      date: new Date('2024-02-01T00:00:00Z'),
      customerIds: ['cust-a', 'cust-x'],
    }
    const fullResultPersonAndCompany = selectBestPrice(fullSet, personAndCompany)
    const narrowedResultPersonAndCompany = selectBestPrice(narrow(personAndCompany), personAndCompany)
    expect(fullResultPersonAndCompany?.id).toBe('contract-cust-a')
    expect(narrowedResultPersonAndCompany?.id).toBe(fullResultPersonAndCompany?.id)
  })
})
