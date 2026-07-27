import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { QueryEngine, QueryOptions, QueryResult } from '@open-mercato/shared/lib/query/types'
import {
  ContextResolverImpl,
  type RetrievedSnippet,
} from '../lib/context/contextResolver'
import {
  registerContextModule,
  entityProvenance,
  retrievalProvenance,
  type ContextModule,
} from '../lib/context/registry'
import {
  contextBundleRoutedSourcesSchema,
  contextBundleSourcesSchema,
  type ContextRoutedSource,
} from '../data/validators'

/**
 * In-memory EntityManager fake (mirrors context-assembly.test.ts) covering the
 * create/persist/flush surface the resolver uses so we can assert assembly
 * without a DB.
 */
function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  const pending: Array<Record<string, unknown>> = []
  let idSeq = 0

  function storeFor(entity: unknown): Array<Record<string, unknown>> {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }

  const em = {
    create(entity: unknown, data: Record<string, unknown>) {
      const row: Record<string, unknown> = { ...data }
      ;(row as { __entity?: unknown }).__entity = entity
      return row
    },
    persist(row: Record<string, unknown>) {
      pending.push(row)
      return em
    },
    async flush() {
      for (const row of pending.splice(0)) {
        if (!row.id) row.id = `id-${++idSeq}`
        const entity = (row as { __entity?: unknown }).__entity
        const store = storeFor(entity)
        if (!store.includes(row)) store.push(row)
      }
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
}

type QueryCall = { entity: string; opts: QueryOptions }
type SearchCall = { query: string; options: Record<string, unknown> }

type SearchRow = {
  entityId: string
  recordId: string
  score: number
  source?: string
  organizationId?: string | null
  presenter?: { title?: string; subtitle?: string }
}

/**
 * Fake container resolving `queryEngine` (entity reads) and `searchService`
 * (retrieval). The searchService records every call and ORG-SCOPES its fixtures
 * itself so the test can prove no cross-tenant hit ever flows through.
 */
function fakeContainer(opts: {
  fixtures: Record<string, Array<Record<string, unknown>>>
  searchRows: SearchRow[]
  queryCalls: QueryCall[]
  searchCalls: SearchCall[]
}): AwilixContainer {
  const queryEngine: QueryEngine = {
    async query<T = unknown>(entity: string, queryOpts: QueryOptions = {}): Promise<QueryResult<T>> {
      opts.queryCalls.push({ entity, opts: queryOpts })
      const items = (opts.fixtures[entity] ?? []) as unknown as T[]
      return { items, page: 1, pageSize: 100, total: items.length }
    },
  }
  const searchService = {
    async search(query: string, options: Record<string, unknown>): Promise<SearchRow[]> {
      opts.searchCalls.push({ query, options })
      const orgFilter = options.organizationId as string | undefined
      // The real searchService org-scopes; the fake honours it so a cross-tenant
      // fixture row can never be returned for the run scope.
      return opts.searchRows.filter((row) => !orgFilter || row.organizationId === orgFilter)
    },
  }
  return {
    hasRegistration(name: string) {
      return name === 'queryEngine' || name === 'searchService'
    },
    resolve(name: string) {
      if (name === 'queryEngine') return queryEngine
      if (name === 'searchService') return searchService
      throw new Error(`[internal] unexpected resolve("${name}") in test`)
    },
  } as unknown as AwilixContainer
}

const TENANT = '11111111-1111-1111-1111-111111111111'
const ORG = '22222222-2222-2222-2222-222222222222'
const OTHER_ORG = '44444444-4444-4444-4444-444444444444'
const RUN_ID = '55555555-5555-5555-5555-555555555555'

const CAPABILITY = 'test.retrieval.capability'
const MANDATORY_ENTITY = 'test:retrieval_subject'
const RETRIEVAL_ENTITY = 'test:retrieval_doc'

const TEST_MODULE: ContextModule = {
  capability: CAPABILITY,
  sources: [
    {
      kind: 'entity',
      tier: 'mandatory',
      entityType: MANDATORY_ENTITY,
      priority: 0,
      fields: ['id', 'title'],
      provenance: entityProvenance(MANDATORY_ENTITY),
    },
    {
      kind: 'retrieval',
      tier: 'optional',
      entityType: RETRIEVAL_ENTITY,
      entityTypes: [RETRIEVAL_ENTITY],
      priority: 10,
      fields: [],
      limit: 10,
      provenance: retrievalProvenance(),
    },
  ],
}

beforeAll(() => {
  registerContextModule(TEST_MODULE)
})

function baseInput(overrides: Partial<{ budget: number }> = {}) {
  return {
    tenantId: TENANT,
    organizationId: ORG,
    agentRunId: RUN_ID,
    processId: null,
    stepId: null,
    capability: CAPABILITY,
    budget: overrides.budget ?? 4000,
  }
}

function inScopeRows(): SearchRow[] {
  return [
    {
      entityId: RETRIEVAL_ENTITY,
      recordId: 'doc-1',
      score: 0.9,
      organizationId: ORG,
      presenter: { title: 'Renewal policy', subtitle: 'section 4' },
    },
    {
      entityId: RETRIEVAL_ENTITY,
      recordId: 'doc-2',
      score: 0.5,
      organizationId: ORG,
      presenter: { title: 'Prior case note' },
    },
    // Cross-tenant row — different org; the searchService scope must exclude it.
    {
      entityId: RETRIEVAL_ENTITY,
      recordId: 'leak-1',
      score: 0.99,
      organizationId: OTHER_ORG,
      presenter: { title: 'OTHER TENANT SECRET' },
    },
  ]
}

describe('retrieve() grounding contract (searchService RRF wrap, Phase 2)', () => {
  it('returns ONLY citable snippets — every hit carries sourceRef + locator + score', async () => {
    const { em } = createFakeEm()
    const queryCalls: QueryCall[] = []
    const searchCalls: SearchCall[] = []
    const container = fakeContainer({
      fixtures: { [MANDATORY_ENTITY]: [{ id: 'subject-1', title: 'Acme renewal' }] },
      searchRows: inScopeRows(),
      queryCalls,
      searchCalls,
    })
    const resolver = new ContextResolverImpl(container)

    const snippets = await resolver.retrieve(em, 'renewal', {
      tenantId: TENANT,
      organizationId: ORG,
      capability: CAPABILITY,
    })

    expect(snippets.length).toBeGreaterThan(0)
    for (const snippet of snippets) {
      expect(snippet.sourceRef).toBeTruthy()
      expect(snippet.locator).toBeTruthy()
      expect(typeof snippet.locator).toBe('string')
      expect(typeof snippet.score).toBe('number')
      expect(snippet.snippet.length).toBeGreaterThan(0)
    }
    // The retrieval hits are present and citable by `<entityType>:<recordId>`.
    const retrieval = snippets.filter((snippet) => snippet.sourceKind === 'retrieval')
    expect(retrieval.length).toBe(2)
    expect(retrieval.find((snippet) => snippet.locator === `${RETRIEVAL_ENTITY}:doc-1`)).toBeDefined()
  })

  it('drops malformed (uncitable) search rows rather than emitting them without a locator/score', async () => {
    const { em } = createFakeEm()
    const malformed = [
      { entityId: RETRIEVAL_ENTITY, recordId: 'ok-1', score: 0.7, organizationId: ORG },
      { entityId: RETRIEVAL_ENTITY, organizationId: ORG }, // no recordId / score → uncitable
      { recordId: 'no-entity', score: 0.3, organizationId: ORG }, // no entityId → uncitable
    ] as unknown as SearchRow[]
    const container = fakeContainer({
      fixtures: { [MANDATORY_ENTITY]: [{ id: 'subject-1', title: 'subj' }] },
      searchRows: malformed,
      queryCalls: [],
      searchCalls: [],
    })
    const resolver = new ContextResolverImpl(container)

    const snippets = await resolver.retrieve(em, 'q', {
      tenantId: TENANT,
      organizationId: ORG,
      capability: CAPABILITY,
    })

    const retrieval = snippets.filter((snippet) => snippet.sourceKind === 'retrieval')
    expect(retrieval).toHaveLength(1)
    expect(retrieval[0].locator).toBe(`${RETRIEVAL_ENTITY}:ok-1`)
    // No snippet may lack a locator/score.
    for (const snippet of snippets) {
      expect(snippet.locator).toBeTruthy()
      expect(typeof snippet.score).toBe('number')
    }
  })

  it('org-scopes the searchService call (never cross-tenant)', async () => {
    const { em } = createFakeEm()
    const searchCalls: SearchCall[] = []
    const container = fakeContainer({
      fixtures: { [MANDATORY_ENTITY]: [{ id: 'subject-1', title: 'subj' }] },
      searchRows: inScopeRows(),
      queryCalls: [],
      searchCalls,
    })
    const resolver = new ContextResolverImpl(container)

    const snippets = await resolver.retrieve(em, 'renewal', {
      tenantId: TENANT,
      organizationId: ORG,
      capability: CAPABILITY,
    })

    expect(searchCalls.length).toBeGreaterThan(0)
    for (const call of searchCalls) {
      expect(call.options.tenantId).toBe(TENANT)
      expect(call.options.organizationId).toBe(ORG)
      expect(call.options.organizationId).not.toBe(OTHER_ORG)
      // Least-privilege retrieval allowlist forwarded.
      expect(call.options.entityTypes).toEqual([RETRIEVAL_ENTITY])
    }
    // The cross-tenant row never surfaces as a snippet.
    expect(snippets.some((snippet) => snippet.locator.includes('leak-1'))).toBe(false)
  })

  it('degrades to no retrieval snippets when searchService is unregistered', async () => {
    const { em } = createFakeEm()
    const container = {
      hasRegistration(name: string) {
        return name === 'queryEngine'
      },
      resolve(name: string) {
        if (name === 'queryEngine') {
          return {
            async query() {
              return { items: [{ id: 'subject-1', title: 'subj' }], page: 1, pageSize: 100, total: 1 }
            },
          }
        }
        throw new Error(`[internal] unexpected resolve("${name}")`)
      },
    } as unknown as AwilixContainer
    const resolver = new ContextResolverImpl(container)

    const snippets = await resolver.retrieve(em, 'q', {
      tenantId: TENANT,
      organizationId: ORG,
      capability: CAPABILITY,
    })

    // Entity grounding still works; retrieval is just empty (optional fill).
    expect(snippets.every((snippet) => snippet.sourceKind !== 'retrieval')).toBe(true)
  })
})

describe('assemble() retrieval as optional fill (Phase 2)', () => {
  it('routes the mandatory floor FIRST, then packs retrieval hits as optional fill', async () => {
    const { em } = createFakeEm()
    const container = fakeContainer({
      fixtures: { [MANDATORY_ENTITY]: [{ id: 'subject-1', title: 'Acme renewal' }] },
      searchRows: inScopeRows(),
      queryCalls: [],
      searchCalls: [],
    })
    const resolver = new ContextResolverImpl(container)

    const { bundle } = await resolver.assemble(em, baseInput())

    const routed = contextBundleRoutedSourcesSchema.parse(bundle.routedSources) as ContextRoutedSource[]
    const sources = contextBundleSourcesSchema.parse(bundle.sources)

    // Mandatory entity floor is routed.
    expect(routed.some((source) => source.kind === 'entity' && source.ref === 'subject-1')).toBe(true)
    // Retrieval hits are packed as optional fill, carrying their score + locator.
    const retrievalRouted = routed.filter((source) => source.kind === 'retrieval')
    expect(retrievalRouted.length).toBeGreaterThan(0)
    for (const source of retrievalRouted) {
      expect(typeof source.score).toBe('number')
      expect(source.locator).toBeTruthy()
    }
    // Provenance for retrieval facts is stamped (retrieval: lineage).
    expect(
      sources.some((fact) => fact.sourceKind === 'retrieval' && fact.factId.startsWith('retrieval:')),
    ).toBe(true)
    // No cross-tenant row was assembled.
    expect(routed.some((source) => source.ref.includes('leak-1'))).toBe(false)
  })

  it('prunes retrieval fill that does not fit while the mandatory floor stays routed (fill is AFTER the floor)', async () => {
    const { em } = createFakeEm()
    const container = fakeContainer({
      fixtures: { [MANDATORY_ENTITY]: [{ id: 'subject-1', title: 'A'.repeat(120) }] },
      searchRows: [
        {
          entityId: RETRIEVAL_ENTITY,
          recordId: 'doc-1',
          score: 0.9,
          organizationId: ORG,
          presenter: { title: 'B'.repeat(400) },
        },
      ],
      queryCalls: [],
      searchCalls: [],
    })
    const resolver = new ContextResolverImpl(container)

    // Budget big enough for the mandatory floor but not the retrieval fill.
    const { bundle } = await resolver.assemble(em, baseInput({ budget: 40 }))

    const routed = bundle.routedSources as ContextRoutedSource[]
    const pruned = (bundle.prunedSources ?? []) as Array<{ ref: string; kind: string; reason: string }>

    expect(routed.some((source) => source.kind === 'entity' && source.ref === 'subject-1')).toBe(true)
    expect(routed.some((source) => source.kind === 'retrieval')).toBe(false)
    const prunedRetrieval = pruned.find((source) => source.kind === 'retrieval')
    expect(prunedRetrieval).toBeDefined()
    expect(prunedRetrieval?.reason).toBe('over_budget')
    expect(bundle.tokensUsed).toBeLessThanOrEqual(bundle.tokenBudget)
  })
})
