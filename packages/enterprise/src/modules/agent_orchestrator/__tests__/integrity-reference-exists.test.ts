import { createContainer, asValue, type AwilixContainer } from 'awilix'
import { z } from 'zod'
import type {
  AgentReferenceResolver,
  ReferenceLookup,
  ReferenceResolution,
  ReferenceResolverScope,
} from '@open-mercato/shared/lib/ai/referenceResolver'
import { referenceExistsRuleSchema, type ReferenceExistsRule } from '../data/validators'
import { GuardrailService } from '../lib/guardrails/guardrailService'
import { runOutputPipeline } from '../lib/guardrails/integrity/pipeline'
import { evaluateReferenceExists } from '../lib/guardrails/integrity/rules/referenceExists'
import type { IntegrityRuleContext } from '../lib/guardrails/integrity/types'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

type Catalog = Record<string, string | null>

type FakeResolver = AgentReferenceResolver & {
  calls: Array<{ refs: ReferenceLookup[]; scope: ReferenceResolverScope }>
}

function catalogResolver(catalog: Catalog): FakeResolver {
  const calls: FakeResolver['calls'] = []
  return {
    id: 'acme.rule',
    contractVersion: 1,
    calls,
    async resolve(refs, scope) {
      calls.push({ refs, scope })
      const resolutions = new Map<string, ReferenceResolution>()
      for (const ref of refs) {
        if (!(ref.id in catalog)) {
          resolutions.set(ref.id, { status: 'not_found' })
        } else if (ref.version && catalog[ref.id] !== ref.version) {
          resolutions.set(ref.id, { status: 'version_mismatch', currentVersion: catalog[ref.id] })
        } else {
          resolutions.set(ref.id, { status: 'exists', version: catalog[ref.id] })
        }
      }
      return resolutions
    },
  }
}

function containerWith(resolver?: unknown): AwilixContainer {
  const container = createContainer()
  if (resolver !== undefined) container.register({ 'agentReferenceResolver:acme.rule': asValue(resolver) })
  return container
}

function buildRule(overrides: Record<string, unknown> = {}): ReferenceExistsRule {
  return referenceExistsRuleSchema.parse({
    id: 'rule-ids',
    kind: 'reference_exists',
    ids: 'findings[*].ruleId',
    resolver: 'acme.rule',
    ...overrides,
  })
}

function buildContext(
  output: unknown,
  container: AwilixContainer | undefined,
  input: unknown = {},
): IntegrityRuleContext {
  return {
    output,
    input,
    toolCalls: [],
    guardrailSetVersion: 'i1-test',
    scope: SCOPE,
    ...(container ? { container } : {}),
  }
}

function findings(ruleIds: unknown[]): { findings: Array<{ title: string; ruleId: unknown }> } {
  return { findings: ruleIds.map((ruleId, index) => ({ title: `finding-${index}`, ruleId })) }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((child) => deepFreeze(child))
    Object.freeze(value)
  }
  return value
}

describe('reference_exists integrity rule', () => {
  it('passes when every reference exists', async () => {
    const resolver = catalogResolver({ 'R-1': 'v1', 'R-2': 'v1' })
    const output = findings(['R-1', 'R-2'])
    const outcome = await evaluateReferenceExists(buildContext(output, containerWith(resolver)), buildRule())
    expect(outcome.check).toEqual({
      kind: 'reference_exists',
      result: 'pass',
      guardrailSetVersion: 'i1-test',
      evidence: { ruleId: 'rule-ids', items: 2, violations: [], dropped: 0, repaired: 0, ambiguous: 0 },
    })
    expect(outcome.output).toBe(output)
    expect(outcome.changed).toBe(false)
    expect(outcome.blocked).toBe(false)
  })

  it('drops the enclosing item of an unknown reference by default', async () => {
    const resolver = catalogResolver({ 'R-1': 'v1' })
    const output = findings(['R-1', 'R-404'])
    const outcome = await evaluateReferenceExists(buildContext(output, containerWith(resolver)), buildRule())
    expect(outcome.output).toEqual(findings(['R-1']))
    expect(outcome.changed).toBe(true)
    expect(outcome.check.result).toBe('warn')
    expect(outcome.check.evidence).toMatchObject({
      violations: [{ itemPath: 'findings[1].ruleId', reason: 'not_found' }],
      dropped: 1,
    })
    expect(outcome.check.evidence).not.toHaveProperty('holdsAutoApproval')
  })

  it('keeps an unknown reference and holds auto-approval under flag', async () => {
    const resolver = catalogResolver({})
    const output = findings(['R-404'])
    const outcome = await evaluateReferenceExists(
      buildContext(output, containerWith(resolver)),
      buildRule({ onViolation: 'flag' }),
    )
    expect(outcome.output).toBe(output)
    expect(outcome.check.result).toBe('warn')
    expect(outcome.check.evidence).toMatchObject({ dropped: 0, holdsAutoApproval: true })
  })

  it('blocks on an unknown reference under block', async () => {
    const resolver = catalogResolver({})
    const output = findings(['R-404'])
    const outcome = await evaluateReferenceExists(
      buildContext(output, containerWith(resolver)),
      buildRule({ onViolation: 'block' }),
    )
    expect(outcome.blocked).toBe(true)
    expect(outcome.check.result).toBe('block')
    expect(outcome.output).toBe(output)
  })

  it('pins every reference to the version read from the run input', async () => {
    const resolver = catalogResolver({ 'R-1': 'v2', 'R-2': 'v1' })
    const outcome = await evaluateReferenceExists(
      buildContext(findings(['R-1', 'R-2']), containerWith(resolver), { rulesVersion: 'v1' }),
      buildRule({ version: { input: 'rulesVersion' } }),
    )
    expect(resolver.calls[0].refs).toEqual([
      { id: 'R-1', version: 'v1' },
      { id: 'R-2', version: 'v1' },
    ])
    expect(outcome.output).toEqual({ findings: [{ title: 'finding-1', ruleId: 'R-2' }] })
    expect(outcome.check.evidence).toMatchObject({
      violations: [{ itemPath: 'findings[0].ruleId', reason: 'version_mismatch' }],
    })
  })

  it('treats a pinned input version that is absent as a violation', async () => {
    const resolver = catalogResolver({ 'R-1': 'v1' })
    const outcome = await evaluateReferenceExists(
      buildContext(findings(['R-1']), containerWith(resolver), {}),
      buildRule({ version: { input: 'rulesVersion' }, onViolation: 'flag' }),
    )
    expect(resolver.calls).toHaveLength(0)
    expect(outcome.check.evidence).toMatchObject({
      violations: [{ itemPath: 'findings[0].ruleId', reason: 'version_missing' }],
      holdsAutoApproval: true,
    })
  })

  it('pins every reference to a constant version', async () => {
    const resolver = catalogResolver({ 'R-1': 'v1' })
    const outcome = await evaluateReferenceExists(
      buildContext(findings(['R-1']), containerWith(resolver)),
      buildRule({ version: { const: 'v9' }, onViolation: 'flag' }),
    )
    expect(resolver.calls[0].refs).toEqual([{ id: 'R-1', version: 'v9' }])
    expect(outcome.check.evidence).toMatchObject({
      violations: [{ itemPath: 'findings[0].ruleId', reason: 'version_mismatch' }],
    })
  })

  it('reads a per-item pinned version and object ids through idPath', async () => {
    const resolver = catalogResolver({ 'R-1': 'v1', 'R-2': 'v1' })
    const output = {
      refs: [
        { ref: { key: 'R-1' }, pinned: 'v1' },
        { ref: { key: 'R-2' }, pinned: 'v3' },
      ],
    }
    const outcome = await evaluateReferenceExists(
      buildContext(output, containerWith(resolver)),
      buildRule({ ids: 'refs[*]', idPath: 'ref.key', version: { path: 'pinned' } }),
    )
    expect(resolver.calls[0].refs).toEqual([
      { id: 'R-1', version: 'v1' },
      { id: 'R-2', version: 'v3' },
    ])
    expect(outcome.output).toEqual({ refs: [{ ref: { key: 'R-1' }, pinned: 'v1' }] })
  })

  it('reads the claimed version of an object reference through versionPath', async () => {
    const resolver = catalogResolver({ 'R-1': 'v1' })
    const output = { refs: [{ id: 'R-1', version: 'v1' }, { id: 'R-1', version: 'v0' }] }
    const outcome = await evaluateReferenceExists(
      buildContext(output, containerWith(resolver)),
      buildRule({ ids: 'refs[*]', versionPath: 'version' }),
    )
    expect(outcome.output).toEqual({ refs: [{ id: 'R-1', version: 'v1' }] })
    expect(outcome.check.evidence).toMatchObject({
      violations: [{ itemPath: 'refs[1]', reason: 'version_mismatch' }],
    })
  })

  it('parses key@version strings with the configured separator', async () => {
    const resolver = catalogResolver({ 'R-1': 'v1', 'kb.article': '7' })
    const output = { citations: ['R-1@v1', 'R-1@v2', 'kb.article#7'] }
    const outcome = await evaluateReferenceExists(
      buildContext(output, containerWith(resolver)),
      buildRule({ ids: 'citations[*]', onViolation: 'flag' }),
    )
    expect(resolver.calls[0].refs).toEqual([
      { id: 'R-1', version: 'v1' },
      { id: 'R-1', version: 'v2' },
      { id: 'kb.article#7', version: null },
    ])
    expect(outcome.check.evidence).toMatchObject({
      violations: [
        { itemPath: 'citations[1]', reason: 'version_mismatch' },
        { itemPath: 'citations[2]', reason: 'not_found' },
      ],
    })

    const custom = catalogResolver({ 'kb.article': '7' })
    const customOutcome = await evaluateReferenceExists(
      buildContext(output, containerWith(custom)),
      buildRule({ ids: 'citations[2]', versionSeparator: '#' }),
    )
    expect(custom.calls[0].refs).toEqual([{ id: 'kb.article', version: '7' }])
    expect(customOutcome.check.result).toBe('pass')
  })

  it('flags a resolver reporting a different version than the expected one', async () => {
    const resolver: AgentReferenceResolver = {
      id: 'acme.rule',
      contractVersion: 1,
      resolve: async () => new Map<string, ReferenceResolution>([['R-1', { status: 'exists', version: 'v2' }]]),
    }
    const outcome = await evaluateReferenceExists(
      buildContext(findings(['R-1@v1']), containerWith(resolver)),
      buildRule({ onViolation: 'flag' }),
    )
    expect(outcome.check.evidence).toMatchObject({
      violations: [{ itemPath: 'findings[0].ruleId', reason: 'version_mismatch' }],
    })
  })

  it('records an item without a usable id as a violation', async () => {
    const resolver = catalogResolver({ 'R-1': 'v1' })
    const outcome = await evaluateReferenceExists(
      buildContext(findings(['R-1', 42, '']), containerWith(resolver)),
      buildRule(),
    )
    expect(outcome.output).toEqual(findings(['R-1']))
    expect(outcome.check.evidence).toMatchObject({
      violations: [
        { itemPath: 'findings[1].ruleId', reason: 'id_missing' },
        { itemPath: 'findings[2].ruleId', reason: 'id_missing' },
      ],
      dropped: 2,
    })
  })

  it('blocks when the resolver is not registered (default onResolverMissing)', async () => {
    const output = findings(['R-1'])
    const outcome = await evaluateReferenceExists(buildContext(output, containerWith()), buildRule())
    expect(outcome.blocked).toBe(true)
    expect(outcome.output).toBe(output)
    expect(outcome.check).toMatchObject({ result: 'block', evidence: { detail: 'resolver_missing', violations: [] } })
  })

  it('blocks when no container is available', async () => {
    const outcome = await evaluateReferenceExists(buildContext(findings(['R-1']), undefined), buildRule())
    expect(outcome.check).toMatchObject({ result: 'block', evidence: { detail: 'resolver_missing' } })
  })

  it('keeps the references unverified and holds auto-approval with onResolverMissing flag', async () => {
    const output = findings(['R-1'])
    const outcome = await evaluateReferenceExists(
      buildContext(output, containerWith({ notAResolver: true })),
      buildRule({ onResolverMissing: 'flag' }),
    )
    expect(outcome.blocked).toBe(false)
    expect(outcome.output).toBe(output)
    expect(outcome.check).toMatchObject({
      result: 'warn',
      evidence: { detail: 'resolver_missing', holdsAutoApproval: true, dropped: 0 },
    })
  })

  it('fails closed when the resolver throws', async () => {
    const resolver: AgentReferenceResolver = {
      id: 'acme.rule',
      contractVersion: 1,
      resolve: async () => {
        throw new Error('database unavailable')
      },
    }
    const outcome = await evaluateReferenceExists(buildContext(findings(['R-1']), containerWith(resolver)), buildRule())
    expect(outcome.blocked).toBe(true)
    expect(outcome.check.evidence).toMatchObject({ detail: 'resolver_error' })

    const flagged = await evaluateReferenceExists(
      buildContext(findings(['R-1']), containerWith(resolver)),
      buildRule({ onResolverMissing: 'flag' }),
    )
    expect(flagged.check).toMatchObject({ result: 'warn', evidence: { detail: 'resolver_error', holdsAutoApproval: true } })
  })

  it('blocks when the run has no organization scope', async () => {
    const resolver = catalogResolver({ 'R-1': 'v1' })
    const outcome = await evaluateReferenceExists(
      { ...buildContext(findings(['R-1']), containerWith(resolver)), scope: { tenantId: 'tenant-1', organizationId: null } },
      buildRule(),
    )
    expect(resolver.calls).toHaveLength(0)
    expect(outcome.check).toMatchObject({ result: 'block', evidence: { detail: 'scope_missing' } })
  })

  it('resolves unique references in one batched call with the run scope', async () => {
    const resolver = catalogResolver({ 'R-1': 'v1', 'R-2': 'v1' })
    await evaluateReferenceExists(
      buildContext(findings(['R-1', 'R-2', 'R-1', 'R-2@v1', 'R-2@v1']), containerWith(resolver)),
      buildRule(),
    )
    expect(resolver.calls).toHaveLength(1)
    expect(resolver.calls[0].scope).toEqual(SCOPE)
    expect(resolver.calls[0].refs).toEqual([
      { id: 'R-1', version: null },
      { id: 'R-2', version: null },
      { id: 'R-2', version: 'v1' },
    ])
  })

  it('does not call the resolver when there are no references', async () => {
    const resolver = catalogResolver({})
    const outcome = await evaluateReferenceExists(buildContext(findings([]), containerWith(resolver)), buildRule())
    expect(resolver.calls).toHaveLength(0)
    expect(outcome.check.result).toBe('pass')
  })

  it('never puts reference ids into the evidence', async () => {
    const resolver = catalogResolver({})
    const outcome = await evaluateReferenceExists(
      buildContext(findings(['SECRET-REF-1', 'SECRET-REF-2@v7']), containerWith(resolver)),
      buildRule({ onViolation: 'flag' }),
    )
    const serialized = JSON.stringify(outcome.check)
    expect(serialized).not.toContain('SECRET-REF')
    expect(serialized).not.toContain('v7')
  })

  it('caps the evidence at 20 violations', async () => {
    const resolver = catalogResolver({})
    const ids = Array.from({ length: 25 }, (_, index) => `R-${index}`)
    const outcome = await evaluateReferenceExists(
      buildContext(findings(ids), containerWith(resolver)),
      buildRule({ onViolation: 'flag' }),
    )
    expect((outcome.check.evidence as { violations: unknown[] }).violations).toHaveLength(20)
    expect(outcome.check.evidence).toMatchObject({ items: 25 })
  })

  it('never mutates the output or the input', async () => {
    const resolver = catalogResolver({ 'R-1': 'v1' })
    const output = deepFreeze(findings(['R-1', 'R-404']))
    const input = deepFreeze({ rulesVersion: 'v1' })
    const outcome = await evaluateReferenceExists(
      buildContext(output, containerWith(resolver), input),
      buildRule({ version: { input: 'rulesVersion' } }),
    )
    expect(output.findings).toHaveLength(2)
    expect(outcome.output).toEqual(findings(['R-1']))
  })
})

describe('reference_exists in the output pipeline', () => {
  const schema = z.object({ findings: z.array(z.object({ title: z.string(), ruleId: z.string() })) })

  function pipelineArgs(container: AwilixContainer, rule: ReferenceExistsRule, shadow = false) {
    return {
      entry: { schema, integrity: [rule] },
      rawObject: findings(['R-1', 'R-404']),
      input: {},
      toolCalls: [],
      guardrailService: new GuardrailService({} as never),
      capability: 'test.agent',
      allowedTools: [],
      attemptedTools: [],
      guardrailSetVersion: 'i1-test',
      scope: SCOPE,
      container,
      shadow,
    }
  }

  it('runs the async rule and returns the dropped output as final', async () => {
    const resolver = catalogResolver({ 'R-1': 'v1' })
    const result = await runOutputPipeline(pipelineArgs(containerWith(resolver), buildRule()))
    expect(result.finalOutput).toEqual(findings(['R-1']))
    expect(result.changed).toBe(true)
    expect(result.verdict.checks.find((entry) => entry.kind === 'reference_exists')?.result).toBe('warn')
  })

  it('records a would-be block as a shadow warn and keeps the raw output', async () => {
    const result = await runOutputPipeline(pipelineArgs(containerWith(), buildRule(), true))
    expect(result.finalOutput).toEqual(findings(['R-1', 'R-404']))
    expect(result.verdict.result).not.toBe('block')
    const check = result.verdict.checks.find((entry) => entry.kind === 'reference_exists')
    expect(check).toMatchObject({
      result: 'warn',
      evidence: { detail: 'resolver_missing', shadow: true, wouldBlock: true },
    })
  })

  it('records a shadow drop without changing the output', async () => {
    const resolver = catalogResolver({ 'R-1': 'v1' })
    const result = await runOutputPipeline(pipelineArgs(containerWith(resolver), buildRule(), true))
    expect(result.changed).toBe(false)
    expect(result.finalOutput).toEqual(findings(['R-1', 'R-404']))
    expect(result.verdict.checks.find((entry) => entry.kind === 'reference_exists')?.evidence).toMatchObject({
      dropped: 1,
      shadow: true,
    })
  })
})
