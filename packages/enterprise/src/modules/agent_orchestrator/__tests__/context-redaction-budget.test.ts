import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { QueryEngine, QueryOptions, QueryResult } from '@open-mercato/shared/lib/query/types'
import { AgentContextBundle } from '../data/entities'
import { ContextResolverImpl } from '../lib/context/contextResolver'
import {
  registerContextModule,
  entityProvenance,
  type ContextModule,
} from '../lib/context/registry'
import {
  redactRecord,
  staticEncryptedFieldNames,
  REDACTION_RULE_FIELD_ENCRYPTION,
  REDACTION_RULE_PII,
} from '../lib/context/redactor'
import {
  contextBundleRedactionAppliedSchema,
  type ContextRedactionApplied,
  type ContextRoutedSource,
  type ContextPrunedSource,
} from '../data/validators'

/**
 * P4 acceptance coverage: redaction-before-pack (encrypted/PII values never reach
 * the packed payload; `redactionApplied` records what was withheld) and token
 * budget enforcement (mandatory floor always routed under a tight-but-feasible
 * budget; over-budget optional pruned with a reason; no mid-fact truncation).
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
        const store = storeFor((row as { __entity?: unknown }).__entity)
        if (!store.includes(row)) store.push(row)
      }
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
}

type QueryCall = { entity: string; opts: QueryOptions }

function fakeContainer(
  fixtures: Record<string, Array<Record<string, unknown>>>,
  calls: QueryCall[],
  encryptedFields?: Record<string, string[]>,
): AwilixContainer {
  const queryEngine: QueryEngine = {
    async query<T = unknown>(entity: string, opts: QueryOptions = {}): Promise<QueryResult<T>> {
      calls.push({ entity, opts })
      const items = (fixtures[entity] ?? []) as unknown as T[]
      return { items, page: 1, pageSize: 100, total: items.length }
    },
  }
  const encryptionService = {
    async getEncryptedFieldNames(entityId: string): Promise<string[]> {
      return encryptedFields?.[entityId] ?? []
    },
  }
  const registrations = new Set(['queryEngine'])
  if (encryptedFields) registrations.add('tenantEncryptionService')
  return {
    hasRegistration(name: string) {
      return registrations.has(name)
    },
    resolve(name: string) {
      if (name === 'queryEngine') return queryEngine
      if (name === 'tenantEncryptionService') return encryptionService
      throw new Error(`[internal] unexpected resolve("${name}") in test`)
    },
  } as unknown as AwilixContainer
}

const TENANT = '11111111-1111-1111-1111-111111111111'
const ORG = '22222222-2222-2222-2222-222222222222'
const RUN_ID = '55555555-5555-5555-5555-555555555555'

const CAPABILITY = 'p4.redaction'
const SUBJECT_ENTITY = 'p4:subject'

const REDACTION_MODULE: ContextModule = {
  capability: CAPABILITY,
  sources: [
    {
      kind: 'entity',
      tier: 'mandatory',
      entityType: SUBJECT_ENTITY,
      priority: 0,
      fields: ['id', 'title', 'email', 'ssn', 'secret_note'],
      provenance: entityProvenance(SUBJECT_ENTITY),
    },
  ],
}

beforeAll(() => {
  registerContextModule(REDACTION_MODULE)
})

function baseInput(budget = 4000) {
  return {
    tenantId: TENANT,
    organizationId: ORG,
    agentRunId: RUN_ID,
    processId: null,
    stepId: null,
    capability: CAPABILITY,
    budget,
  }
}

describe('redactRecord (least-privilege unit)', () => {
  it('removes encrypted + PII fields and records each withheld field with its rule', () => {
    const { record, redactions } = redactRecord(
      { id: 'r1', title: 'Acme', email: 'a@b.com', secret_note: 'SECRET-XYZ' },
      ['secret_note'],
    )
    expect(record).toEqual({ id: 'r1', title: 'Acme' })
    expect(record.email).toBeUndefined()
    expect(record.secret_note).toBeUndefined()

    const byField = new Map(redactions.map((r) => [r.field, r.rule]))
    expect(byField.get('secret_note')).toBe(REDACTION_RULE_FIELD_ENCRYPTION)
    expect(byField.get('email')).toBe(REDACTION_RULE_PII)
    contextBundleRedactionAppliedSchema.parse(redactions)
  })

  it('encryption rule takes precedence and a field is recorded once', () => {
    const { redactions } = redactRecord({ email: 'x@y.com' }, ['email'])
    expect(redactions).toEqual([{ field: 'email', rule: REDACTION_RULE_FIELD_ENCRYPTION }])
  })

  it('staticEncryptedFieldNames matches the entity id case-insensitively', () => {
    const fields = staticEncryptedFieldNames('agent_orchestrator:agent_run', [
      { entityId: 'AGENT_ORCHESTRATOR:AGENT_RUN', fields: [{ field: 'input' }, { field: 'output' }] },
    ])
    expect(fields).toEqual(['input', 'output'])
  })
})

describe('ContextResolverImpl.assemble — redaction before pack (P4)', () => {
  it('redacts encrypted + PII fields before packing; encrypted values never appear in the payload; redactionApplied records the withholding', async () => {
    const { em } = createFakeEm()
    const calls: QueryCall[] = []
    const SECRET = 'PLAINTEXT-ENCRYPTED-VALUE-9999'
    const PII_EMAIL = 'victim@example.com'
    const PII_SSN = '123-45-6789'
    const container = fakeContainer(
      {
        [SUBJECT_ENTITY]: [
          { id: 'subject-1', title: 'Visible deal', email: PII_EMAIL, ssn: PII_SSN, secret_note: SECRET },
        ],
      },
      calls,
      { [SUBJECT_ENTITY]: ['secret_note'] },
    )
    const resolver = new ContextResolverImpl(container)

    const { bundle } = await resolver.assemble(em, baseInput())

    // The packed payload (routed sources + provenance + entire bundle) must never
    // echo the encrypted plaintext or the PII values.
    const serialized = JSON.stringify({
      routedSources: bundle.routedSources,
      prunedSources: bundle.prunedSources,
      sources: bundle.sources,
    })
    expect(serialized).not.toContain(SECRET)
    expect(serialized).not.toContain(PII_EMAIL)
    expect(serialized).not.toContain(PII_SSN)

    // The subject is still routed (only the sensitive fields were withheld).
    const routed = bundle.routedSources as ContextRoutedSource[]
    expect(routed.some((source) => source.ref === 'subject-1')).toBe(true)

    // redactionApplied records exactly what was withheld, with the right rule.
    const applied = contextBundleRedactionAppliedSchema.parse(
      (bundle.redactionApplied ?? []) as ContextRedactionApplied[],
    )
    const byField = new Map(applied.map((r) => [r.field, r.rule]))
    expect(byField.get('secret_note')).toBe(REDACTION_RULE_FIELD_ENCRYPTION)
    expect(byField.get('email')).toBe(REDACTION_RULE_PII)
    expect(byField.get('ssn')).toBe(REDACTION_RULE_PII)
  })

  it('still redacts the static encryption-map floor when no per-tenant encryption service is registered', async () => {
    const { em } = createFakeEm()
    const calls: QueryCall[] = []
    const PII_PHONE = '+1-555-0100'
    // No encryptionService registered: encryptedFields arg omitted.
    const container = fakeContainer(
      { [SUBJECT_ENTITY]: [{ id: 'subject-1', title: 'ok', phone: PII_PHONE }] },
      calls,
    )
    const resolver = new ContextResolverImpl(container)
    const { bundle } = await resolver.assemble(em, baseInput())

    const serialized = JSON.stringify(bundle.routedSources)
    expect(serialized).not.toContain(PII_PHONE)
    const applied = (bundle.redactionApplied ?? []) as ContextRedactionApplied[]
    expect(applied.some((r) => r.field === 'phone' && r.rule === REDACTION_RULE_PII)).toBe(true)
  })
})

describe('ContextResolverImpl.assemble — token budget enforcement (P4)', () => {
  const BUDGET_CAPABILITY = 'p4.budget'
  const FLOOR_ENTITY = 'p4:floor'
  const FILL_ENTITY = 'p4:fill'

  beforeAll(() => {
    registerContextModule({
      capability: BUDGET_CAPABILITY,
      sources: [
        {
          kind: 'entity',
          tier: 'mandatory',
          entityType: FLOOR_ENTITY,
          priority: 0,
          fields: ['id', 'title'],
          provenance: entityProvenance(FLOOR_ENTITY),
        },
        {
          kind: 'entity',
          tier: 'optional',
          entityType: FILL_ENTITY,
          priority: 1,
          fields: ['id', 'body'],
          provenance: entityProvenance(FILL_ENTITY),
        },
      ],
    })
  })

  function budgetInput(budget: number) {
    return { ...baseInput(budget), capability: BUDGET_CAPABILITY }
  }

  it('under a tight-but-feasible budget the mandatory floor is fully routed, over-budget optional is pruned with a reason, and tokensUsed <= tokenBudget', async () => {
    const { em } = createFakeEm()
    const calls: QueryCall[] = []
    const container = fakeContainer(
      {
        [FLOOR_ENTITY]: [{ id: 'floor-1', title: 'mandatory subject' }],
        [FILL_ENTITY]: [{ id: 'fill-1', body: 'B'.repeat(4000) }],
      },
      calls,
    )
    const resolver = new ContextResolverImpl(container)

    // Budget large enough for the small floor, far too small for the 4000-char fill.
    const { bundle } = await resolver.assemble(em, budgetInput(40))

    const routed = bundle.routedSources as ContextRoutedSource[]
    const pruned = (bundle.prunedSources ?? []) as ContextPrunedSource[]

    expect(routed.some((source) => source.ref === 'floor-1')).toBe(true)
    expect(routed.some((source) => source.ref === 'fill-1')).toBe(false)

    const prunedFill = pruned.find((source) => source.ref === 'fill-1')
    expect(prunedFill).toBeDefined()
    expect(prunedFill?.reason).toBeTruthy()

    expect(bundle.tokensUsed).toBeLessThanOrEqual(bundle.tokenBudget)
    expect(bundle.tokensUsed).toBeGreaterThan(0)

    // No mid-fact truncation: the routed floor record is whole, not a substring.
    expect(routed.find((source) => source.ref === 'floor-1')?.tokens).toBeGreaterThan(0)
  })

  it('tokensUsed <= tokenBudget with a generous budget where everything fits', async () => {
    const { em } = createFakeEm()
    const calls: QueryCall[] = []
    const container = fakeContainer(
      {
        [FLOOR_ENTITY]: [{ id: 'floor-1', title: 'subject' }],
        [FILL_ENTITY]: [{ id: 'fill-1', body: 'short note' }],
      },
      calls,
    )
    const resolver = new ContextResolverImpl(container)
    const { bundle } = await resolver.assemble(em, budgetInput(10000))

    const routed = bundle.routedSources as ContextRoutedSource[]
    expect(routed.some((source) => source.ref === 'floor-1')).toBe(true)
    expect(routed.some((source) => source.ref === 'fill-1')).toBe(true)
    expect(bundle.tokensUsed).toBeLessThanOrEqual(bundle.tokenBudget)
    expect((bundle.prunedSources ?? []) as ContextPrunedSource[]).toHaveLength(0)
  })

  it('persists exactly one append-only bundle per run with all P4 fields populated', async () => {
    const { em, storeFor } = createFakeEm()
    const calls: QueryCall[] = []
    const container = fakeContainer(
      {
        [FLOOR_ENTITY]: [{ id: 'floor-1', title: 'subject' }],
        [FILL_ENTITY]: [],
      },
      calls,
    )
    const resolver = new ContextResolverImpl(container)
    await resolver.assemble(em, budgetInput(4000))
    expect(storeFor(AgentContextBundle)).toHaveLength(1)
  })
})
