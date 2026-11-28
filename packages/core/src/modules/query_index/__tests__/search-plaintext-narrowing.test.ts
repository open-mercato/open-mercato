/**
 * #5803 with OM_SEARCH_USE_ILIKE_FOR_NON_ENCRYPTED_FIELDS off (the default, #5383): a like/ilike on a
 * PLAINTEXT base column still runs through the hashed search-token EXISTS, but is ANDed with a
 * folded per-word containment predicate so the lossy tokenization (`2026-08` and `2026-01` both
 * reduce to {202, 2026}) can no longer return the wrong record. Encrypted columns and an unknown
 * encryption map keep the token predicate alone. Compiled against a dummy Postgres dialect so the
 * emitted SQL itself is asserted.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely'
import { HybridQueryEngine } from '../lib/engine'

const database = new Kysely<Record<string, Record<string, unknown>>>({ dialect: {
  createAdapter: () => new PostgresAdapter(), createDriver: () => new DummyDriver(),
  createIntrospector: (db) => new PostgresIntrospector(db), createQueryCompiler: () => new PostgresQueryCompiler(),
} })
const base = () => database.selectFrom('customers as b').select('b.id')
type Builder = ReturnType<typeof base>
type Filter = { field: string; op: 'ilike' | 'like'; value: string }
type Runtime = ReturnType<typeof runtime>
type HybridInternals = {
  applyColumnFilter: (builder: Builder, column: string, filter: Filter, search: Runtime & { entity: string; field: string; recordIdColumn: string }) => Builder
  buildBaseFilterExpression: (eb: unknown, filter: Filter, resolveBaseColumn: (field: string) => string | null, qualify: (column: string) => string, entity: string, search: Runtime) => never
}
const entity = 'customers:customer_entity'
const hybrid = new HybridQueryEngine({ getKysely: () => database } as unknown as EntityManager, {} as never) as unknown as HybridInternals

function runtime(knownEncryptedFields: Set<string> | null | undefined, useIlikeForNonEncryptedFields = false) {
  let seq = 0
  return {
    enabled: true,
    config: {
      enabled: true, minTokenLength: 3, enablePartials: true, hashAlgorithm: 'sha256' as const,
      storeRawTokens: false, blocklistedFields: [], useIlikeForNonEncryptedFields,
    },
    tenantId: 't1',
    organizationScope: null,
    searchSources: [{ entity, recordIdColumn: 'b.id' }],
    mintAlias: () => `st_${seq++}`,
    encryptedFields: useIlikeForNonEncryptedFields ? knownEncryptedFields : null,
    knownEncryptedFields,
  }
}

const applyFilter = (value: string, rt: Runtime, field = 'display_name') =>
  hybrid.applyColumnFilter(base(), `b.${field}`, { field, op: 'ilike', value }, {
    ...rt, entity, field, recordIdColumn: 'b.id',
  }).compile()

describe('HybridQueryEngine plaintext token-search narrowing (#5803, flag off)', () => {
  test('a plaintext column ANDs the token EXISTS with the folded containment', () => {
    const query = applyFilter('%2026-08%', runtime(new Set(['primary_email'])))
    expect(query.sql).toContain('exists (select 1 as "one" from "search_tokens"')
    expect(query.sql).toContain('normalize(("b"."display_name")::text, NFKD)')
    expect(query.sql).toMatch(/\) ilike \$\d+$/)
    expect(query.parameters).toContain('%2026%08%')
  })

  test('multi-word terms stay word-order independent (TC-RESO-009)', () => {
    const query = applyFilter('%Warehouse 1757%', runtime(new Set()))
    expect(query.sql).toContain('exists (select 1 as "one" from "search_tokens"')
    expect(query.sql).toContain('ilike all (array[')
    expect(query.parameters).toEqual(expect.arrayContaining(['%warehouse%', '%1757%']))
    expect(query.parameters).not.toContain('%warehouse%1757%')
  })

  test('a term too short to tokenize filters by containment instead of matching every row', () => {
    const query = applyFilter('%08%', runtime(new Set()))
    expect(query.sql).not.toContain('search_tokens')
    expect(query.sql).toContain('ilike')
    expect(query.parameters).toContain('%08%')
  })

  test('an encrypted column keeps the token EXISTS alone, across name shapes', () => {
    const query = applyFilter('%2026-08%', runtime(new Set(['displayName'])))
    expect(query.sql).toContain('exists (select 1 as "one" from "search_tokens"')
    expect(query.sql).not.toContain('ilike')
    expect(query.sql).not.toContain('normalize(')
  })

  test.each([null, undefined])('an unknown encryption map (%p) keeps the legacy token-only predicate', (known) => {
    const query = applyFilter('%2026-08%', runtime(known))
    expect(query.sql).toContain('exists (select 1 as "one" from "search_tokens"')
    expect(query.sql).not.toContain('ilike')
  })

  test('the opt-in switch keeps its own reroute and never adds the token narrowing', () => {
    const query = applyFilter('%2026-08%', runtime(new Set(), true))
    expect(query.sql).not.toContain('search_tokens')
    expect(query.sql).not.toContain('normalize(')
    expect(query.parameters).toEqual(['%2026-08%'])
  })

  test('OR-across-fields search narrows each field branch, not the disjunction', () => {
    const rt = runtime(new Set(['primary_email']))
    const query = base().where((eb) => eb.or(['display_name', 'primary_email'].map((field) =>
      hybrid.buildBaseFilterExpression(eb, { field, op: 'ilike', value: '%2026-08%' }, (name) => name, (column) => `b.${column}`, entity, rt),
    ))).compile()
    const [plaintextBranch, encryptedBranch] = query.sql.split(') or exists (')
    expect(plaintextBranch).toContain('search_tokens')
    expect(plaintextBranch).toContain('normalize(("b"."display_name")::text, NFKD)')
    expect(encryptedBranch).toContain('search_tokens')
    expect(encryptedBranch).not.toContain('normalize(')
    expect(plaintextBranch).toMatch(/^select .* where \(\(exists \(.*\) and replace\(.*\) ilike \$\d+$/)
  })

  test('OR-group leaf too short to tokenize compiles to containment rather than a widening true', () => {
    const query = base().where((eb) => eb.or([
      hybrid.buildBaseFilterExpression(eb, { field: 'display_name', op: 'ilike', value: '%08%' }, (name) => name, (column) => `b.${column}`, entity, runtime(new Set())),
      eb('b.id', '=', 'x'),
    ])).compile()
    expect(query.sql).not.toContain('true')
    expect(query.sql).toContain('ilike')
    expect(query.parameters).toContain('%08%')
  })
})
