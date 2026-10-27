import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { AgentGuardrailSet } from '../data/entities'
import {
  guardrailSetBodySchema,
  integrityRuleSchema,
  type IntegrityRule,
} from '../data/validators'
import { GuardrailService } from '../lib/guardrails/guardrailService'
import { guardrailSetVersionFor, resolveGroundingSet } from '../lib/guardrails/groundingSets'
import { resolveCurrentGroundingSet, syncGroundingSets } from '../lib/guardrails/syncGroundingSets'
import {
  integritySetBodyFor,
  integritySetVersionFor,
  isAgentIntegrityEnforced,
  resolveIntegritySet,
  syncIntegritySets,
} from '../lib/guardrails/integrity/integritySets'
import { runOutputPipeline } from '../lib/guardrails/integrity/pipeline'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const GROUNDING_CAPABILITY = 'deals.health_check'
const CONTENT = 'The supplier shall deliver within 30 days. Late delivery incurs a penalty of 2% per week.'

function createFakeEm() {
  const rows: Array<Record<string, unknown>> = []
  const pending: Array<Record<string, unknown>> = []
  let flushes = 0
  const em = {
    create(_entity: unknown, data: Record<string, unknown>) {
      return { ...data }
    },
    persist(row: Record<string, unknown>) {
      pending.push(row)
      return em
    },
    async flush() {
      flushes += 1
      rows.push(...pending.splice(0))
    },
    async findOne(entity: unknown, where: Record<string, unknown>) {
      if (entity !== AgentGuardrailSet) return null
      return rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null
    },
  }
  return { em: em as unknown as EntityManager, rows, flushCount: () => flushes }
}

function quoteRule(overrides: Record<string, unknown> = {}): IntegrityRule {
  return integrityRuleSchema.parse({
    id: 'quotes',
    kind: 'evidence_quote',
    items: 'proposal.evidence[*]',
    quote: 'quote',
    source: { input: 'content' },
    ...overrides,
  })
}

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([key, child]) => [key, reverseKeys(child)]),
    )
  }
  return value
}

describe('integrity set versioning', () => {
  it('hashes to an i1- prefixed 24-hex version that is stable across key order', () => {
    const body = integritySetBodyFor({ id: 'test.integrity_agent', integrity: [quoteRule()] })
    const version = integritySetVersionFor(body)
    expect(version).toMatch(/^i1-[0-9a-f]{24}$/)
    const reordered = reverseKeys(body) as typeof body
    expect(Object.keys(reordered.rules[0])).not.toEqual(Object.keys(body.rules[0]))
    expect(Object.keys(reordered)).not.toEqual(Object.keys(body))
    expect(integritySetVersionFor(reordered)).toBe(version)
  })

  it('changes the version when a rule changes', () => {
    const base = integritySetVersionFor(integritySetBodyFor({ id: 'test.integrity_agent', integrity: [quoteRule()] }))
    const edited = integritySetVersionFor(
      integritySetBodyFor({ id: 'test.integrity_agent', integrity: [quoteRule({ onViolation: 'flag' })] }),
    )
    expect(edited).not.toBe(base)
  })

  it('builds the body with the agent id as capability and no untrusted inputs', () => {
    const body = integritySetBodyFor({ id: 'test.integrity_agent', integrity: [quoteRule()] })
    expect(body).toEqual({
      kind: 'integrity',
      capability: 'test.integrity_agent',
      rules: [quoteRule()],
      untrustedInputs: [],
    })
  })

  it('resolves null for an agent without rules and caches the resolved set', () => {
    expect(resolveIntegritySet({ id: 'test.no_rules' })).toBeNull()
    expect(resolveIntegritySet({ id: 'test.empty_rules', integrity: [] })).toBeNull()
    const entry = { id: 'test.cached', integrity: [quoteRule()] }
    expect(resolveIntegritySet(entry)).toBe(resolveIntegritySet(entry))
  })
})

describe('guardrail set body union', () => {
  it('parses existing grounding bodies unchanged', () => {
    const grounding = resolveGroundingSet(GROUNDING_CAPABILITY)
    expect(grounding).not.toBeNull()
    expect(guardrailSetBodySchema.parse(grounding)).toEqual(grounding)
  })

  it('parses integrity bodies and defaults untrustedInputs', () => {
    const parsed = guardrailSetBodySchema.parse({
      kind: 'integrity',
      capability: 'test.integrity_agent',
      rules: [quoteRule()],
    })
    expect(parsed.kind).toBe('integrity')
    expect(parsed).toMatchObject({ untrustedInputs: [] })
  })

  it('rejects an unknown kind', () => {
    expect(guardrailSetBodySchema.safeParse({ kind: 'other', capability: 'x' }).success).toBe(false)
  })
})

describe('syncIntegritySets', () => {
  it('is idempotent and appends a new version when the rule set changes', async () => {
    const { em, rows, flushCount } = createFakeEm()
    const entry = { id: 'test.integrity_agent', integrity: [quoteRule()] }

    expect(await syncIntegritySets(em, SCOPE, [entry, { id: 'test.no_rules' }])).toBe(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      capability: 'test.integrity_agent',
      version: resolveIntegritySet(entry)?.version,
      body: { kind: 'integrity', capability: 'test.integrity_agent' },
    })

    expect(await syncIntegritySets(em, SCOPE, [entry])).toBe(0)
    expect(rows).toHaveLength(1)
    expect(flushCount()).toBe(1)

    const changed = { id: 'test.integrity_agent', integrity: [quoteRule({ onViolation: 'block' })] }
    expect(await syncIntegritySets(em, SCOPE, [changed])).toBe(1)
    expect(rows.map((row) => row.version)).toEqual([
      resolveIntegritySet(entry)?.version,
      resolveIntegritySet(changed)?.version,
    ])
  })

  it('leaves grounding resolution unaffected by integrity rows for the same capability', async () => {
    const { em, rows } = createFakeEm()
    await syncGroundingSets(em, SCOPE)
    await syncIntegritySets(em, SCOPE, [{ id: GROUNDING_CAPABILITY, integrity: [quoteRule()] }])
    expect(rows).toHaveLength(2)

    const resolved = await resolveCurrentGroundingSet(em, SCOPE, GROUNDING_CAPABILITY)
    expect(resolved?.version).toBe(guardrailSetVersionFor(resolveGroundingSet(GROUNDING_CAPABILITY)!))
    expect(resolved?.body).toMatchObject({ kind: 'grounding' })
  })

  it('ignores a non-grounding body stored under the grounding version', async () => {
    const { em, rows } = createFakeEm()
    rows.push({
      organizationId: SCOPE.organizationId,
      capability: GROUNDING_CAPABILITY,
      version: guardrailSetVersionFor(resolveGroundingSet(GROUNDING_CAPABILITY)!),
      body: integritySetBodyFor({ id: GROUNDING_CAPABILITY, integrity: [quoteRule()] }),
    })
    expect(await resolveCurrentGroundingSet(em, SCOPE, GROUNDING_CAPABILITY)).toBeNull()
  })
})

describe('OM_AGENT_INTEGRITY shadow mode', () => {
  const schema = z.object({
    kind: z.literal('proposal'),
    proposal: z.object({ evidence: z.array(z.object({ quote: z.string() })) }),
  })
  const rawObject = {
    kind: 'proposal',
    proposal: { evidence: [{ quote: 'deliver within 30 days' }, { quote: 'free shipping forever' }] },
  }

  afterEach(() => {
    delete process.env.OM_AGENT_INTEGRITY
  })

  function runPipeline(rule: IntegrityRule, shadow: boolean) {
    return runOutputPipeline({
      entry: { schema, integrity: [rule] },
      rawObject,
      input: { content: CONTENT },
      toolCalls: [],
      guardrailService: new GuardrailService({} as never),
      capability: 'test.integrity_agent',
      allowedTools: [],
      attemptedTools: [],
      guardrailSetVersion: 'i1-test',
      shadow,
    })
  }

  it('reads the switch strictly, defaulting to on', () => {
    expect(isAgentIntegrityEnforced()).toBe(true)
    process.env.OM_AGENT_INTEGRITY = ' OFF '
    expect(isAgentIntegrityEnforced()).toBe(false)
    process.env.OM_AGENT_INTEGRITY = 'on'
    expect(isAgentIntegrityEnforced()).toBe(true)
  })

  it('records a drop without applying it', async () => {
    const result = await runPipeline(quoteRule({ onViolation: 'drop' }), true)
    expect(result.changed).toBe(false)
    expect(result.finalOutput).toBe(rawObject)
    expect(result.changedCheckIndexes).toEqual([])
    const integrityCheck = result.verdict.checks.find((check) => check.kind === 'evidence_quote')
    expect(integrityCheck?.result).toBe('warn')
    expect(integrityCheck?.evidence).toMatchObject({ shadow: true, dropped: 1 })
    expect(integrityCheck?.evidence).not.toHaveProperty('holdsAutoApproval')
    expect(integrityCheck?.evidence).not.toHaveProperty('wouldBlock')
  })

  it('records a would-be block as warn and keeps evaluating the remaining checks', async () => {
    const result = await runPipeline(quoteRule({ onViolation: 'block' }), true)
    expect(result.verdict.result).toBe('warn')
    expect(result.verdict.blockedReason).toBeUndefined()
    expect(result.finalOutput).toBe(rawObject)
    expect(result.verdict.checks.map((check) => check.kind)).toEqual(['schema', 'evidence_quote', 'tool_scope'])
    const integrityCheck = result.verdict.checks.find((check) => check.kind === 'evidence_quote')
    expect(integrityCheck).toMatchObject({
      result: 'warn',
      guardrailSetVersion: 'i1-test',
      evidence: { shadow: true, wouldBlock: true },
    })
  })

  it('enforces the same rule when shadow mode is off', async () => {
    const result = await runPipeline(quoteRule({ onViolation: 'block' }), false)
    expect(result.verdict.result).toBe('block')
  })
})
