import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { AgentGuardrailCheck, AgentGuardrailSet } from '../data/entities'
import {
  GuardrailService,
  persistVerdict,
} from '../lib/guardrails/guardrailService'
import {
  guardrailSetVersionFor,
  resolveGroundingSet,
} from '../lib/guardrails/groundingSets'
import { syncGroundingSets, resolveCurrentGroundingSet } from '../lib/guardrails/syncGroundingSets'
import { guardrailSetBodySchema, type CitableSource, type GuardrailSetBody } from '../data/validators'

/**
 * In-memory EntityManager fake (mirrors guardrails-output.test.ts) covering the
 * create/persist/flush + findOne surface the grounding sync + persistVerdict need.
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
    async findOne(entity: unknown, where: Record<string, unknown>) {
      const store = storeFor(entity)
      return (
        store.find((row) =>
          Object.entries(where).every(([key, value]) => row[key] === value),
        ) ?? null
      )
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
}

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1', agentRunId: 'run-1' }
const CAPABILITY = 'deals.health_check'

function fakeContainer() {
  return {} as unknown as import('awilix').AwilixContainer
}

// The factual capability's proposal contract: claims carry citations into the bundle.
const factualSchema = z.object({
  kind: z.literal('actionable'),
  proposal: z.object({
    claims: z.array(
      z.object({
        claim: z.string(),
        citations: z.array(
          z.object({ sourceKind: z.string(), sourceRef: z.string(), locator: z.string() }),
        ),
      }),
    ),
  }),
})

const CITABLE_SOURCES: CitableSource[] = [
  { sourceKind: 'entity', sourceRef: 'deal-1', locator: 'customers:deal:deal-1', score: 1 },
  { sourceKind: 'retrieval', sourceRef: 'activity-9', locator: 'customers:activity:activity-9', score: 0.8 },
]

function groundingArgs(version: string) {
  const set = resolveGroundingSet(CAPABILITY)!
  return { set, groundingSetVersion: version, citableSources: CITABLE_SOURCES }
}

describe('GuardrailService.checkOutput grounding (Wave 3 P4, cite-or-abstain)', () => {
  const version = guardrailSetVersionFor(resolveGroundingSet(CAPABILITY)!)

  it('ungrounded factual claim (no citation) → block; one grounding row; tripped fires with version', async () => {
    const { em, storeFor } = createFakeEm()
    const emit = jest.fn().mockResolvedValue(undefined)
    const service = new GuardrailService(fakeContainer())

    const output = {
      kind: 'actionable',
      proposal: { claims: [{ claim: 'deal is at risk', citations: [] }] },
    }
    const verdict = await service.checkOutput({
      capability: CAPABILITY,
      schema: factualSchema,
      output,
      allowedTools: [],
      grounding: groundingArgs(version),
    })

    expect(verdict.result).toBe('block')
    expect(verdict.blockedReason).toEqual({ phase: 'output', kind: 'grounding' })

    await persistVerdict({ em, emit }, SCOPE, {
      verdict,
      capability: CAPABILITY,
      phase: 'output',
      proposalId: null,
    })

    const rows = storeFor(AgentGuardrailCheck)
    const groundingRows = rows.filter((row) => row.kind === 'grounding')
    expect(groundingRows).toHaveLength(1)
    expect(groundingRows[0].result).toBe('block')
    expect(groundingRows[0].guardrailSetVersion).toBe(version)

    const trippedCalls = emit.mock.calls.filter(
      ([id]) => id === 'agent_orchestrator.guardrail.tripped',
    )
    const groundingTripped = trippedCalls.filter(([, payload]) => (payload as { kind: string }).kind === 'grounding')
    expect(groundingTripped).toHaveLength(1)
    expect(groundingTripped[0][1]).toMatchObject({
      kind: 'grounding',
      result: 'block',
      guardrailSetVersion: version,
    })

    // Evidence: pointers only — never the raw claim payload beyond a redaction-safe label.
    const evidence = groundingRows[0].evidence as { uncitedCount?: number; flaggedClaims?: string[] }
    expect(evidence.uncitedCount).toBe(1)
  })

  it('unresolvable citation (resolves to no surfaced source) → block', async () => {
    const service = new GuardrailService(fakeContainer())
    const output = {
      kind: 'actionable',
      proposal: {
        claims: [
          {
            claim: 'deal closed last quarter',
            citations: [{ sourceKind: 'entity', sourceRef: 'ghost-deal', locator: 'customers:deal:ghost-deal' }],
          },
        ],
      },
    }
    const verdict = await service.checkOutput({
      capability: CAPABILITY,
      schema: factualSchema,
      output,
      allowedTools: [],
      grounding: groundingArgs(version),
    })
    expect(verdict.result).toBe('block')
    const grounding = verdict.checks.find((check) => check.kind === 'grounding')
    expect((grounding?.evidence as { unresolvableCount?: number })?.unresolvableCount).toBe(1)
  })

  it('grounded factual claim (cited to a surfaced bundle source) → grounding pass', async () => {
    const service = new GuardrailService(fakeContainer())
    const output = {
      kind: 'actionable',
      proposal: {
        claims: [
          {
            claim: 'deal amount is 5000',
            citations: [{ sourceKind: 'entity', sourceRef: 'deal-1', locator: 'customers:deal:deal-1' }],
          },
        ],
      },
    }
    const verdict = await service.checkOutput({
      capability: CAPABILITY,
      schema: factualSchema,
      output,
      allowedTools: [],
      grounding: groundingArgs(version),
    })
    expect(verdict.result).toBe('pass')
    expect(verdict.checks.find((check) => check.kind === 'grounding')?.result).toBe('pass')
  })

  it('non-factual capability (no grounding set) → no grounding check', async () => {
    const service = new GuardrailService(fakeContainer())
    const schema = z.object({ kind: z.literal('informative'), data: z.unknown() })
    const verdict = await service.checkOutput({
      capability: 'some.toolless_agent',
      schema,
      output: { kind: 'informative', data: { ok: true } },
      allowedTools: [],
    })
    expect(verdict.result).toBe('pass')
    expect(verdict.checks.find((check) => check.kind === 'grounding')).toBeUndefined()
  })
})

describe('grounding set versioning (content-hash, YAML→DB idempotent sync)', () => {
  it('editing a set body produces a new content-hash version', () => {
    const base = resolveGroundingSet(CAPABILITY)!
    const v1 = guardrailSetVersionFor(base)
    const edited: GuardrailSetBody = guardrailSetBodySchema.parse({ ...base, missingCitation: 'warn' })
    const v2 = guardrailSetVersionFor(edited)
    expect(v1).not.toBe(v2)
    // Stable: re-hashing the same body yields the same version.
    expect(guardrailSetVersionFor(base)).toBe(v1)
  })

  it('sync is idempotent: re-syncing an unchanged body writes no new version', async () => {
    const { em, storeFor } = createFakeEm()
    const scope = { tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId }

    const firstWritten = await syncGroundingSets(em, scope)
    expect(firstWritten).toBeGreaterThan(0)
    const afterFirst = storeFor(AgentGuardrailSet).length

    const secondWritten = await syncGroundingSets(em, scope)
    expect(secondWritten).toBe(0)
    expect(storeFor(AgentGuardrailSet).length).toBe(afterFirst)
  })

  it('resolveCurrentGroundingSet reflects the current declared version', async () => {
    const { em } = createFakeEm()
    const scope = { tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId }
    await syncGroundingSets(em, scope)

    const resolved = await resolveCurrentGroundingSet(em, scope, CAPABILITY)
    expect(resolved).not.toBeNull()
    expect(resolved!.version).toBe(guardrailSetVersionFor(resolveGroundingSet(CAPABILITY)!))

    const nonFactual = await resolveCurrentGroundingSet(em, scope, 'some.toolless_agent')
    expect(nonFactual).toBeNull()
  })
})
