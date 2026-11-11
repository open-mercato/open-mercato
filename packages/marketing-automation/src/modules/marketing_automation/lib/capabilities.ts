import type { EntityManager } from '@mikro-orm/postgresql'
import { CATALOG_PRODUCTS, SALES_ORDERS } from './external/tables.js'

/**
 * Whether the modules this one USES but does not require are actually there.
 *
 * `index.ts` does NOT declare them yet, and that is deliberate. `sales` and `catalog` stay in `requires` —
 * a hard gate that fails `yarn generate` — until every reader degrades, because a module that announces an
 * optional dependency while half its queries still assume the tables exist turns a clear generator failure
 * into a 500 on the audience screen. That is strictly worse than the hard dependency it would replace.
 *
 * So this probe is the work that EARNS the declaration, one reader at a time. The remaining unguarded readers
 * are named in the module's commit history and the declaration moves when the list is empty.
 *
 * Asked of the DATABASE rather than of the module registry, because the precondition is the table, not the
 * registration. `sales` enabled with its migrations unapplied is a real state — a half-finished install, a
 * restored dump, a developer mid-rebase — and the registry would answer "present" while the query still failed.
 * `to_regclass` answers the question actually being asked.
 */
export type MarketingCapabilities = {
  /** Order history: aggregates, purchased skus, channels, revenue attribution, referral conversion. */
  sales: boolean
  /** Live product classification: category targeting and price watches. */
  catalog: boolean
}

const PROBES: Record<keyof MarketingCapabilities, string> = {
  sales: SALES_ORDERS,
  catalog: CATALOG_PRODUCTS,
}

/**
 * Cached for the life of the process.
 *
 * The answer changes only when migrations run, and enabling a module already requires `yarn generate` and a
 * restart — so a per-request probe would buy nothing and cost a round trip on every audience evaluation, which
 * is the hottest path in the module. `resetCapabilityCache` exists for tests, and is the only way to clear it.
 */
let cached: MarketingCapabilities | null = null
let inFlight: Promise<MarketingCapabilities> | null = null

export function resetCapabilityCache(): void {
  cached = null
  inFlight = null
}

async function probe(em: EntityManager): Promise<MarketingCapabilities> {
  const entries = Object.entries(PROBES) as [keyof MarketingCapabilities, string][]
  /**
   * One statement for all of them, and `to_regclass` rather than `information_schema`.
   *
   * `to_regclass` respects the search path, so it answers for the schema this connection actually reads —
   * which is the schema the failing query would have used.
   */
  const rows = await em.execute<Array<Record<string, boolean>>>(
    `select ${entries.map(([name, table]) => `to_regclass('${table}') is not null as "${name}"`).join(', ')}`,
  )
  const row = rows?.[0] ?? {}
  return {
    sales: row.sales === true,
    catalog: row.catalog === true,
  }
}

export async function readCapabilities(em: EntityManager): Promise<MarketingCapabilities> {
  if (cached) return cached
  /**
   * Shared in flight, so a cold start serving twenty concurrent requests probes once.
   *
   * A failed probe is NOT cached: a connection that was down when the first request arrived must not leave the
   * module permanently convinced that sales does not exist, which would silently empty every order audience.
   */
  if (!inFlight) {
    inFlight = probe(em)
      .then((result) => {
        cached = result
        return result
      })
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}

/** Convenience for the many call sites that need exactly one answer. */
export async function hasSales(em: EntityManager): Promise<boolean> {
  return (await readCapabilities(em)).sales
}

export async function hasCatalog(em: EntityManager): Promise<boolean> {
  return (await readCapabilities(em)).catalog
}
