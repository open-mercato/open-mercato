import type { Kysely } from 'kysely'

/**
 * Narrows an EntityManager-like value to a MikroORM v7 PG EntityManager and returns its
 * Kysely client, or `null` when the value doesn't expose `getKysely`.
 *
 * MikroORM v7's `@mikro-orm/postgresql` EntityManager ships `getKysely<TDb>()`, but the
 * shared `EnricherContext` types `em` as `unknown` to keep the contract DB-agnostic. The
 * kanban helpers (`stuckDeals`, `enrichers`) both need the typed client — this helper
 * centralizes the runtime check so neither call site has to repeat `(em as any).getKysely`.
 *
 * Returns `null` (rather than throwing) on purpose: callers fall back to a sensible default
 * (empty stuck-id list, un-enriched records) when the env doesn't have Kysely available
 * (e.g. unit tests with a stub EntityManager).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveKyselyClient<TDb = any>(em: unknown): Kysely<TDb> | null {
  if (em == null || typeof em !== 'object') return null
  const candidate = (em as { getKysely?: unknown }).getKysely
  if (typeof candidate !== 'function') return null
  const db = (candidate as () => unknown).call(em)
  if (db == null) return null
  return db as Kysely<TDb>
}
