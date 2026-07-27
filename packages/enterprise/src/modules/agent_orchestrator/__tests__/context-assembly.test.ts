import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { QueryEngine, QueryOptions, QueryResult } from '@open-mercato/shared/lib/query/types'
import { AgentContextBundle } from '../data/entities'
import {
  ContextResolverImpl,
  ContextModuleNotFoundError,
} from '../lib/context/contextResolver'
import {
  registerContextModule,
  entityProvenance,
  type ContextModule,
} from '../lib/context/registry'
import {
  contextBundleRoutedSourcesSchema,
  contextBundlePrunedSourcesSchema,
  contextBundleSourcesSchema,
  type ContextRoutedSource,
  type ContextPrunedSource,
} from '../data/validators'

/**
 * In-memory EntityManager fake (mirrors guardrails-output.test.ts) covering the
 * create/persist/flush surface the resolver uses. Lets us assert the append-only
 * one-bundle-per-run property without a DB.
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

/**
 * Fake queryEngine that returns per-entityType fixtures and records every call so
 * tests can assert org/tenant scoping. The container only ever resolves
 * `queryEngine` here, plus `em` for the runtime-wiring tests (not exercised here).
 */
function fakeContainer(
  fixtures: Record<string, Array<Record<string, unknown>>>,
  calls: QueryCall[],
): AwilixContainer {
  const queryEngine: QueryEngine = {
    async query<T = unknown>(entity: string, opts: QueryOptions = {}): Promise<QueryResult<T>> {
      calls.push({ entity, opts })
      const items = (fixtures[entity] ?? []) as unknown as T[]
      return { items, page: 1, pageSize: 100, total: items.length }
    },
  }
  return {
    resolve(name: string) {
      if (name === 'queryEngine') return queryEngine
      throw new Error(`[internal] unexpected resolve("${name}") in test`)
    },
  } as unknown as AwilixContainer
}

const TENANT = '11111111-1111-1111-1111-111111111111'
const ORG = '22222222-2222-2222-2222-222222222222'
const OTHER_TENANT = '33333333-3333-3333-3333-333333333333'
const OTHER_ORG = '44444444-4444-4444-4444-444444444444'
const RUN_ID = '55555555-5555-5555-5555-555555555555'

const CAPABILITY = 'test.capability'
const MANDATORY_ENTITY = 'test:subject'
const OPTIONAL_ENTITY = 'test:related'

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
      kind: 'entity',
      tier: 'optional',
      entityType: OPTIONAL_ENTITY,
      priority: 1,
      fields: ['id', 'body'],
      provenance: entityProvenance(OPTIONAL_ENTITY),
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

describe('ContextResolverImpl.assemble (TDCR Phase 1)', () => {
  it('persists exactly one append-only bundle with both tenant ids and all TDCR fields', async () => {
    const { em, storeFor } = createFakeEm()
    const calls: QueryCall[] = []
    const container = fakeContainer(
      {
        [MANDATORY_ENTITY]: [{ id: 'subject-1', title: 'Acme policy' }],
        [OPTIONAL_ENTITY]: [{ id: 'related-1', body: 'prior case note' }],
      },
      calls,
    )
    const resolver = new ContextResolverImpl(container)

    const { bundle } = await resolver.assemble(em, baseInput())

    const bundles = storeFor(AgentContextBundle)
    expect(bundles).toHaveLength(1)

    expect(bundle.tenantId).toBe(TENANT)
    expect(bundle.organizationId).toBe(ORG)
    expect(bundle.agentRunId).toBe(RUN_ID)
    expect(bundle.capability).toBe(CAPABILITY)

    // routed/pruned/sources are present and well-shaped.
    const routed = contextBundleRoutedSourcesSchema.parse(bundle.routedSources)
    expect(routed.length).toBeGreaterThanOrEqual(1)
    contextBundleSourcesSchema.parse(bundle.sources)

    // token budget/usage recorded; never over budget here (small records).
    expect(bundle.tokenBudget).toBe(4000)
    expect(bundle.tokensUsed).toBeGreaterThan(0)
    expect(bundle.tokensUsed).toBeLessThanOrEqual(bundle.tokenBudget)

    // mandatory subject is routed with its provenance stamped.
    const mandatoryRouted = routed.find((source) => source.ref === 'subject-1')
    expect(mandatoryRouted).toBeDefined()
    const provenance = contextBundleSourcesSchema.parse(bundle.sources)
    expect(provenance.some((fact) => fact.sourceRef === 'subject-1' && fact.sourceKind === 'entity')).toBe(true)
    expect(provenance.find((fact) => fact.sourceRef === 'subject-1')?.factId).toBe(`${MANDATORY_ENTITY}#subject-1`)
  })

  it('always routes the mandatory floor even under a tight budget; over-budget optional fill is pruned with a reason', async () => {
    const { em } = createFakeEm()
    const calls: QueryCall[] = []
    const container = fakeContainer(
      {
        [MANDATORY_ENTITY]: [{ id: 'subject-1', title: 'A'.repeat(200) }],
        [OPTIONAL_ENTITY]: [{ id: 'related-1', body: 'B'.repeat(2000) }],
      },
      calls,
    )
    const resolver = new ContextResolverImpl(container)

    // Budget tight enough that the optional fill cannot fit but the mandatory floor must.
    const { bundle } = await resolver.assemble(em, baseInput({ budget: 60 }))

    const routed = bundle.routedSources as ContextRoutedSource[]
    const pruned = (bundle.prunedSources ?? []) as ContextPrunedSource[]

    expect(routed.some((source) => source.ref === 'subject-1')).toBe(true)
    expect(routed.some((source) => source.ref === 'related-1')).toBe(false)

    const prunedOptional = pruned.find((source) => source.ref === 'related-1')
    expect(prunedOptional).toBeDefined()
    expect(prunedOptional?.reason).toBe('over_budget')

    contextBundlePrunedSourcesSchema.parse(pruned)
  })

  it('scopes every queryEngine read to the run tenant + organization (never cross-tenant)', async () => {
    const { em } = createFakeEm()
    const calls: QueryCall[] = []
    const container = fakeContainer(
      {
        [MANDATORY_ENTITY]: [{ id: 'subject-1', title: 'scoped' }],
        [OPTIONAL_ENTITY]: [],
      },
      calls,
    )
    const resolver = new ContextResolverImpl(container)

    await resolver.assemble(em, baseInput())

    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call.opts.tenantId).toBe(TENANT)
      expect(call.opts.organizationId).toBe(ORG)
      // never the foreign scope
      expect(call.opts.tenantId).not.toBe(OTHER_TENANT)
      expect(call.opts.organizationId).not.toBe(OTHER_ORG)
    }
  })

  it('fails closed when the capability has no declared ContextModule', async () => {
    const { em } = createFakeEm()
    const resolver = new ContextResolverImpl(fakeContainer({}, []))
    await expect(
      resolver.assemble(em, { ...baseInput(), capability: 'unknown.capability' }),
    ).rejects.toBeInstanceOf(ContextModuleNotFoundError)
  })
})

describe('ContextResolverImpl.retrieve (grounding seam)', () => {
  it('returns citable snippets (sourceRef + score) for the capability mandatory entity sources', async () => {
    const { em } = createFakeEm()
    const calls: QueryCall[] = []
    const container = fakeContainer(
      {
        [MANDATORY_ENTITY]: [{ id: 'subject-1', title: 'cite me' }],
        [OPTIONAL_ENTITY]: [{ id: 'related-1', body: 'and me' }],
      },
      calls,
    )
    const resolver = new ContextResolverImpl(container)

    const snippets = await resolver.retrieve(em, 'health', {
      tenantId: TENANT,
      organizationId: ORG,
      capability: CAPABILITY,
    })

    expect(snippets.length).toBeGreaterThan(0)
    for (const snippet of snippets) {
      expect(snippet.sourceRef).toBeTruthy()
      expect(typeof snippet.score).toBe('number')
      expect(snippet.snippet.length).toBeGreaterThan(0)
    }
    expect(snippets.some((snippet) => snippet.sourceRef === 'subject-1')).toBe(true)
  })
})
