import { TokenSearchStrategy } from '../strategies/token.strategy'
import { createPresenterEnricher } from '../lib/presenter-enricher'
import {
  registerTenantGlobalEntityTypes,
  resetTenantGlobalEntityTypes,
} from '@open-mercato/core/modules/query_index/lib/tenant-global'
import type { Kysely } from 'kysely'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { SearchEntityConfig, SearchResult } from '../types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { decryptIndexDocForSearch } from '@open-mercato/shared/lib/encryption/indexDoc'

jest.mock('@open-mercato/shared/lib/encryption/indexDoc', () => ({
  decryptIndexDocForSearch: jest.fn(),
}))

/**
 * Both readers of the query index — `TokenSearchStrategy.search()` over `search_tokens`
 * and `fetchDocsBatch()` over `entity_indexes` — must widen their tenant predicate for
 * an entity type declared through `registerTenantGlobalEntityTypes()`, and for nothing
 * else.
 *
 * The two halves are pinned in one file on purpose. They are only correct together: a
 * hit the strategy returns and the enricher cannot resolve is a search result with no
 * title and no URL, which the dialog renders as a raw record id. That divergence is the
 * user-visible defect this change exists to fix, and it can only be asserted by holding
 * both predicates side by side.
 *
 * The predicates are asserted structurally rather than by executing SQL, in the style of
 * `token-strategy-entity-exclusion.test.ts`. What matters is the shape — an OR whose
 * NULL branch is conjoined with an entity-type list — because an unqualified
 * `tenant_id IS NULL` branch would also serve `directory:tenant` and `auth:user_role`,
 * whose source tables have neither scope column and whose projections are therefore
 * stored under the null tenant too.
 */

const GLOBAL_TYPE = 'feature_toggles:feature_toggle'
const PRIVATE_TENANT_LESS_TYPE = 'directory:tenant'
const SCOPED_TYPE = 'customers:customer_person_profile'

type Predicate =
  | { kind: 'cmp'; column: string; op: string; value: unknown }
  | { kind: 'or'; items: Predicate[] }
  | { kind: 'and'; items: Predicate[] }

/**
 * A stand-in for kysely's expression builder that records the predicate tree instead of
 * compiling it. Only the three forms these two queries use are modelled.
 */
function createExpressionBuilder() {
  const eb: any = (column: unknown, op: unknown, value: unknown): Predicate => ({
    kind: 'cmp',
    column: String(column),
    op: String(op),
    value,
  })
  eb.or = (items: Predicate[]): Predicate => ({ kind: 'or', items })
  eb.and = (items: Predicate[]): Predicate => ({ kind: 'and', items })
  return eb
}

function createRecordingDb(rows: unknown[] = []) {
  const predicates: Predicate[] = []
  const chain: any = {
    select: jest.fn(() => chain),
    groupBy: jest.fn(() => chain),
    having: jest.fn(() => chain),
    orderBy: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    execute: jest.fn().mockResolvedValue(rows),
    where: jest.fn((columnOrCallback: unknown, op?: unknown, value?: unknown) => {
      if (typeof columnOrCallback === 'function') {
        predicates.push((columnOrCallback as (eb: unknown) => Predicate)(createExpressionBuilder()))
      } else if (typeof columnOrCallback === 'string' && typeof op === 'string') {
        predicates.push({ kind: 'cmp', column: columnOrCallback, op, value })
      }
      return chain
    }),
  }
  const db: any = { selectFrom: jest.fn(() => chain) }
  return { db: db as Kysely<any>, predicates }
}

/** The one predicate in the recorded tree that constrains `tenant_id`. */
function tenantPredicate(predicates: Predicate[]): Predicate | undefined {
  const mentionsTenant = (predicate: Predicate): boolean => (
    predicate.kind === 'cmp'
      ? predicate.column === 'tenant_id'
      : predicate.items.some(mentionsTenant)
  )
  return predicates.find(mentionsTenant)
}

beforeEach(() => {
  resetTenantGlobalEntityTypes()
})

afterAll(() => {
  resetTenantGlobalEntityTypes()
})

describe('TokenSearchStrategy widens the tenant predicate for declared global entity types', () => {
  it('adds a NULL-tenant branch scoped to the declared types when no entity types are requested', async () => {
    const { db, predicates } = createRecordingDb()
    const strategy = new TokenSearchStrategy(db as never)

    await strategy.search('unified interactions', { tenantId: 'tenant-1' })

    expect(tenantPredicate(predicates)).toEqual({
      kind: 'or',
      items: [
        { kind: 'cmp', column: 'tenant_id', op: '=', value: 'tenant-1' },
        {
          kind: 'and',
          items: [
            { kind: 'cmp', column: 'tenant_id', op: 'is', value: null },
            { kind: 'cmp', column: 'entity_type', op: 'in', value: [GLOBAL_TYPE] },
          ],
        },
      ],
    })
  })

  it('includes a module-registered entity type in the NULL branch', async () => {
    registerTenantGlobalEntityTypes('saas_billing:sb_plan')
    const { db, predicates } = createRecordingDb()
    const strategy = new TokenSearchStrategy(db as never)

    await strategy.search('starter', { tenantId: 'tenant-1' })

    const predicate = tenantPredicate(predicates)
    const nullBranch = predicate?.kind === 'or' ? predicate.items[1] : undefined
    const entityTypes = nullBranch?.kind === 'and' && nullBranch.items[1]?.kind === 'cmp'
      ? nullBranch.items[1].value
      : undefined
    expect(entityTypes).toEqual([GLOBAL_TYPE, 'saas_billing:sb_plan'])
  })

  it('narrows the NULL branch to the requested entity types', async () => {
    const { db, predicates } = createRecordingDb()
    const strategy = new TokenSearchStrategy(db as never)

    await strategy.search('unified interactions', {
      tenantId: 'tenant-1',
      entityTypes: [GLOBAL_TYPE, SCOPED_TYPE],
    })

    const predicate = tenantPredicate(predicates)
    const nullBranch = predicate?.kind === 'or' ? predicate.items[1] : undefined
    expect(nullBranch).toEqual({
      kind: 'and',
      items: [
        { kind: 'cmp', column: 'tenant_id', op: 'is', value: null },
        { kind: 'cmp', column: 'entity_type', op: 'in', value: [GLOBAL_TYPE] },
      ],
    })
  })

  it('keeps a plain equality predicate when no requested entity type is declared global', async () => {
    const { db, predicates } = createRecordingDb()
    const strategy = new TokenSearchStrategy(db as never)

    await strategy.search('ada lovelace', { tenantId: 'tenant-1', entityTypes: [SCOPED_TYPE] })

    expect(tenantPredicate(predicates)).toEqual({
      kind: 'cmp',
      column: 'tenant_id',
      op: '=',
      value: 'tenant-1',
    })
  })

  it('does not widen for a tenant-less table that is private rather than a catalogue', async () => {
    const { db, predicates } = createRecordingDb()
    const strategy = new TokenSearchStrategy(db as never)

    await strategy.search('acme', { tenantId: 'tenant-1', entityTypes: [PRIVATE_TENANT_LESS_TYPE] })

    expect(tenantPredicate(predicates)).toEqual({
      kind: 'cmp',
      column: 'tenant_id',
      op: '=',
      value: 'tenant-1',
    })
  })

  it('stops widening once the declaration is withdrawn', async () => {
    resetTenantGlobalEntityTypes()
    const { db, predicates } = createRecordingDb()
    const strategy = new TokenSearchStrategy(db as never)

    await strategy.search('starter', { tenantId: 'tenant-1', entityTypes: ['saas_billing:sb_plan'] })

    expect(tenantPredicate(predicates)).toEqual({
      kind: 'cmp',
      column: 'tenant_id',
      op: '=',
      value: 'tenant-1',
    })
  })
})

describe('fetchDocsBatch widens the tenant predicate for declared global entity types', () => {
  const queryEngine = { query: jest.fn() } as unknown as QueryEngine

  function createConfig(entityId: string): SearchEntityConfig {
    return {
      entityId: entityId as EntityId,
      buildSource: jest.fn().mockResolvedValue({ text: '', presenter: { title: 'Toggle' } }),
    } as unknown as SearchEntityConfig
  }

  function createResult(entityId: string, recordId: string): SearchResult {
    return { entityId: entityId as EntityId, recordId, score: 1, source: 'tokens' }
  }

  beforeEach(() => {
    jest.mocked(decryptIndexDocForSearch).mockReset()
    jest.mocked(decryptIndexDocForSearch).mockResolvedValue({})
  })

  it('adds a NULL-tenant branch listing only the declared types present in the batch', async () => {
    const { db, predicates } = createRecordingDb([])
    const enrich = createPresenterEnricher(
      db,
      new Map([
        [GLOBAL_TYPE as EntityId, createConfig(GLOBAL_TYPE)],
        [SCOPED_TYPE as EntityId, createConfig(SCOPED_TYPE)],
      ]) as never,
      queryEngine,
      {} as never,
    )

    await enrich(
      [createResult(GLOBAL_TYPE, 'toggle-1'), createResult(SCOPED_TYPE, 'person-1')],
      'tenant-1',
      null,
    )

    expect(tenantPredicate(predicates)).toEqual({
      kind: 'or',
      items: [
        { kind: 'cmp', column: 'tenant_id', op: '=', value: 'tenant-1' },
        {
          kind: 'and',
          items: [
            { kind: 'cmp', column: 'tenant_id', op: 'is', value: null },
            { kind: 'cmp', column: 'entity_type', op: 'in', value: [GLOBAL_TYPE] },
          ],
        },
      ],
    })
  })

  it('keeps a plain equality predicate when the batch holds no declared global type', async () => {
    const { db, predicates } = createRecordingDb([])
    const enrich = createPresenterEnricher(
      db,
      new Map([[SCOPED_TYPE as EntityId, createConfig(SCOPED_TYPE)]]) as never,
      queryEngine,
      {} as never,
    )

    await enrich([createResult(SCOPED_TYPE, 'person-1')], 'tenant-1', null)

    expect(tenantPredicate(predicates)).toEqual({
      kind: 'cmp',
      column: 'tenant_id',
      op: '=',
      value: 'tenant-1',
    })
  })

  it('does not widen for a private tenant-less type whose projection is also stored under NULL', async () => {
    const { db, predicates } = createRecordingDb([])
    const enrich = createPresenterEnricher(
      db,
      new Map([[PRIVATE_TENANT_LESS_TYPE as EntityId, createConfig(PRIVATE_TENANT_LESS_TYPE)]]) as never,
      queryEngine,
      {} as never,
    )

    await enrich([createResult(PRIVATE_TENANT_LESS_TYPE, 'tenant-row-1')], 'tenant-1', null)

    expect(tenantPredicate(predicates)).toEqual({
      kind: 'cmp',
      column: 'tenant_id',
      op: '=',
      value: 'tenant-1',
    })
  })

  it('leaves the organization predicate exactly as it was', async () => {
    const { db, predicates } = createRecordingDb([])
    const enrich = createPresenterEnricher(
      db,
      new Map([[GLOBAL_TYPE as EntityId, createConfig(GLOBAL_TYPE)]]) as never,
      queryEngine,
      {} as never,
    )

    await enrich([createResult(GLOBAL_TYPE, 'toggle-1')], 'tenant-1', 'org-1')

    const organizationPredicate = predicates.find((predicate) => (
      predicate.kind === 'or'
      && predicate.items.every((item) => item.kind === 'cmp' && item.column === 'organization_id')
    ))
    expect(organizationPredicate).toEqual({
      kind: 'or',
      items: [
        { kind: 'cmp', column: 'organization_id', op: '=', value: 'org-1' },
        { kind: 'cmp', column: 'organization_id', op: 'is', value: null },
      ],
    })
  })
})
