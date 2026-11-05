import { HybridQueryEngine } from '../lib/engine'

/**
 * Regression coverage for #2738.
 *
 * `HybridQueryEngine` used to keep its search-token alias counter as instance
 * state (`searchAliasSeq`) and reset it to `0` at the top of every `query()`
 * call. Because the DI container shares one engine instance per request scope,
 * a second `query()` running concurrently resets the counter mid-flight, so the
 * first call re-emits an `st_N` alias it already used inside the same SQL
 * statement — which Postgres rejects at parse time.
 *
 * The fix makes alias allocation owned per `query()` invocation. These tests
 * drive the two methods that mint `search_tokens` aliases and inject the exact
 * mid-statement reset a concurrent call performs; statement-unique aliases must
 * survive it.
 */

/**
 * Minimal expression-builder double that records the alias of every
 * `search_tokens as st_N` subquery the engine builds. Every other builder
 * method is a no-op that keeps the chain fluent.
 */
function createAliasCapturingBuilder(aliases: string[]): any {
  const builder: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'selectFrom') {
          return (raw: unknown) => {
            const match = /search_tokens\s+as\s+(\S+)/i.exec(String(raw))
            if (match) aliases.push(match[1])
            return builder
          }
        }
        return () => builder
      },
    },
  )
  return builder
}

function mintTwiceAcrossConcurrentReset(
  method: 'applySearchTokens' | 'buildSearchTokensSub',
): string[] {
  const engine = new HybridQueryEngine(
    { getKysely: () => ({}) } as any,
    { query: jest.fn() } as any,
  )
  const aliases: string[] = []
  const builder = createAliasCapturingBuilder(aliases)
  let perCallSeq = 0
  const tokenOpts = {
    entity: 'example:todo',
    field: 'title',
    hashes: ['hash-1'],
    recordIdColumn: 'b.id',
    tenantId: 't1',
    // Per-call alias minter — consumed after the fix, ignored by the buggy code.
    mintAlias: () => `st_${perCallSeq++}`,
  }

  // Query A enters query(): the pre-fix code resets the shared counter here.
  ;(engine as any).searchAliasSeq = 0
  ;(engine as any)[method](builder, tokenOpts)

  // A concurrent query() on the SAME engine instance enters and resets the
  // shared counter mid-statement — the `this.searchAliasSeq = 0` from #2738.
  ;(engine as any).searchAliasSeq = 0
  ;(engine as any)[method](builder, tokenOpts)

  return aliases
}

describe('query_index search-alias allocation under concurrency (#2738)', () => {
  test.each(['applySearchTokens', 'buildSearchTokensSub'] as const)(
    '%s keeps statement aliases unique when a concurrent query() resets mid-flight',
    (method) => {
      const aliases = mintTwiceAcrossConcurrentReset(method)

      expect(aliases).toHaveLength(2)
      // Duplicate `st_N` aliases inside one statement are an invalid SQL parse.
      expect(new Set(aliases).size).toBe(aliases.length)
    },
  )
})
