import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import { customIntegrityRuleSchema, type CitableSource, type CustomIntegrityRule } from '../data/validators'
import { GuardrailService } from '../lib/guardrails/guardrailService'
import { INTEGRITY_REPAIR_INVALID, runOutputPipeline } from '../lib/guardrails/integrity/pipeline'
import {
  CUSTOM_CHECKER_ERROR,
  CUSTOM_CHECKER_MISSING,
  CUSTOM_INVALID_REASON,
  CUSTOM_UNADDRESSABLE_PATH,
  evaluateCustomIntegrity,
} from '../lib/guardrails/integrity/rules/custom'
import type { IntegrityRuleContext, IntegrityToolCall } from '../lib/guardrails/integrity/types'
import {
  getIntegrityChecker,
  registerIntegrityChecker,
  resetIntegrityCheckersForTests,
  type IntegrityCheckerFn,
  type IntegrityCheckerInput,
} from '../lib/sdk/integrityCheckers'
import { registerIntegrityChecker as registerFromDefineAgent } from '../lib/sdk/defineAgent'

const CHECKER_ID = 'acme_triage.required_checks'

const schema = z.object({
  kind: z.literal('research'),
  data: z.object({ items: z.array(z.object({ id: z.string(), note: z.string() })) }),
})

type Envelope = z.infer<typeof schema>

function envelope(ids: string[]): Envelope {
  return { kind: 'research', data: { items: ids.map((id) => ({ id, note: `note for ${id}` })) } }
}

function buildRule(overrides: Record<string, unknown> = {}): CustomIntegrityRule {
  return customIntegrityRuleSchema.parse({
    id: 'required-checks',
    kind: 'custom',
    checker: CHECKER_ID,
    onViolation: 'flag',
    ...overrides,
  })
}

const citableSources: CitableSource[] = [
  { sourceKind: 'entity', sourceRef: 'customers:deal:1', locator: 'deal', score: 0.9 },
]

const toolCalls: IntegrityToolCall[] = [{ toolName: 'acme.get_rule', args: { id: 'r1' }, result: { id: 'r1' } }]

function buildContext(output: unknown, overrides: Partial<IntegrityRuleContext> = {}): IntegrityRuleContext {
  return {
    output,
    input: { content: 'deal summary' },
    toolCalls,
    citableSources,
    guardrailSetVersion: 'i1-test',
    scope: { tenantId: 'tenant-1', organizationId: 'org-1' },
    ...overrides,
  }
}

function register(fn: IntegrityCheckerFn): void {
  registerIntegrityChecker(CHECKER_ID, fn)
}

beforeEach(() => {
  resetIntegrityCheckersForTests()
})

describe('registerIntegrityChecker', () => {
  it('registers a checker by id and is re-exported from defineAgent', () => {
    const checker: IntegrityCheckerFn = () => ({ violations: [] })
    registerFromDefineAgent(CHECKER_ID, checker)
    expect(getIntegrityChecker(CHECKER_ID)).toBe(checker)
    expect(getIntegrityChecker('acme_triage.other')).toBeUndefined()
  })

  it('rejects a duplicate checker id', () => {
    register(() => ({ violations: [] }))
    expect(() => register(() => ({ violations: [] }))).toThrow(
      `[internal] duplicate integrity checker id "${CHECKER_ID}"`,
    )
  })

  it.each(['required_checks', 'Acme.checks', 'acme.', '.checks', 'acme checks.x', `acme.${'x'.repeat(200)}`])(
    'rejects the malformed checker id %p',
    (checkerId) => {
      expect(() => registerIntegrityChecker(checkerId, () => ({ violations: [] }))).toThrow(
        /^\[internal\] invalid integrity checker id/,
      )
    },
  )

  it('rejects a non-function checker', () => {
    expect(() => registerIntegrityChecker(CHECKER_ID, 'nope' as unknown as IntegrityCheckerFn)).toThrow(
      /must be a function/,
    )
  })
})

describe('evaluateCustomIntegrity', () => {
  it('hands the checker private copies of output and input plus tool calls, citable sources, scope, container and config', async () => {
    const received: IntegrityCheckerInput[] = []
    register((input) => {
      received.push(input)
      const mutable = input.output as Envelope
      mutable.data.items.length = 0
      return { violations: [] }
    })
    const container = { resolve: jest.fn() } as unknown as AwilixContainer
    const output = envelope(['a'])
    const input = { content: 'deal summary' }
    const result = await evaluateCustomIntegrity(
      buildContext(output, { input, container }),
      buildRule({ config: { minChecks: 2 } }),
    )
    expect(received).toHaveLength(1)
    const [checkerInput] = received
    expect(checkerInput.input).toEqual(input)
    expect(checkerInput.input).not.toBe(input)
    expect(checkerInput.output).not.toBe(output)
    expect(checkerInput.toolCalls).toBe(toolCalls)
    expect(checkerInput.citableSources).toBe(citableSources)
    expect(checkerInput.scope).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(checkerInput.container).toBe(container)
    expect(checkerInput.config).toEqual({ minChecks: 2 })
    expect(output.data.items).toHaveLength(1)
    expect(result.changed).toBe(false)
    expect(result.check).toEqual({
      kind: 'custom_integrity',
      result: 'pass',
      guardrailSetVersion: 'i1-test',
      evidence: {
        ruleId: 'required-checks',
        checker: CHECKER_ID,
        items: 0,
        violations: [],
        dropped: 0,
        repaired: 0,
        ambiguous: 0,
      },
    })
  })

  it('passes an empty citable-source list when the run has none', async () => {
    const received: IntegrityCheckerInput[] = []
    register((input) => {
      received.push(input)
      return { violations: [] }
    })
    await evaluateCustomIntegrity(buildContext(envelope(['a']), { citableSources: undefined }), buildRule())
    expect(received[0].citableSources).toEqual([])
  })

  it('flags violations and holds auto-approval without changing the output', async () => {
    register(() => ({ violations: [{ itemPath: 'data.items[0]', reason: 'check_missing' }] }))
    const output = envelope(['a', 'b'])
    const result = await evaluateCustomIntegrity(buildContext(output), buildRule())
    expect(result.blocked).toBe(false)
    expect(result.changed).toBe(false)
    expect(result.output).toBe(output)
    expect(result.check.result).toBe('warn')
    expect(result.check.evidence).toMatchObject({
      violations: [{ itemPath: 'data.items[0]', reason: 'check_missing' }],
      holdsAutoApproval: true,
      dropped: 0,
    })
  })

  it('drops the nearest enclosing array item of each violation', async () => {
    register(() => ({
      violations: [
        { itemPath: 'data.items[0].note', reason: 'check_missing' },
        { itemPath: 'data.items[2]', reason: 'check_missing' },
      ],
    }))
    const output = envelope(['a', 'b', 'c'])
    const result = await evaluateCustomIntegrity(buildContext(output), buildRule({ onViolation: 'drop' }))
    expect(result.changed).toBe(true)
    expect((result.output as Envelope).data.items.map((item) => item.id)).toEqual(['b'])
    expect(output.data.items).toHaveLength(3)
    expect(result.check.result).toBe('warn')
    expect(result.check.evidence).toMatchObject({ dropped: 2 })
    expect(result.check.evidence?.holdsAutoApproval).toBeUndefined()
  })

  it('keeps an undroppable violation flagged under drop', async () => {
    register(() => ({
      violations: [
        { itemPath: 'data.items[9]', reason: 'check_missing' },
        { itemPath: 'data', reason: 'check_missing' },
      ],
    }))
    const output = envelope(['a'])
    const result = await evaluateCustomIntegrity(buildContext(output), buildRule({ onViolation: 'drop' }))
    expect(result.changed).toBe(false)
    expect(result.output).toBe(output)
    expect(result.check.evidence).toMatchObject({ dropped: 0, holdsAutoApproval: true })
  })

  it('blocks on violations under block', async () => {
    register(() => ({ violations: [{ itemPath: 'data.items[0]', reason: 'check_missing' }] }))
    const output = envelope(['a'])
    const result = await evaluateCustomIntegrity(buildContext(output), buildRule({ onViolation: 'block' }))
    expect(result.blocked).toBe(true)
    expect(result.output).toBe(output)
    expect(result.check.result).toBe('block')
  })

  it('applies repairedOutput as the rule output', async () => {
    register(async ({ output }) => {
      const repaired = structuredClone(output) as Envelope
      repaired.data.items[0].note = 'fixed'
      return { violations: [], repairedOutput: repaired }
    })
    const result = await evaluateCustomIntegrity(buildContext(envelope(['a'])), buildRule())
    expect(result.changed).toBe(true)
    expect((result.output as Envelope).data.items[0].note).toBe('fixed')
    expect(result.check.result).toBe('pass')
    expect(result.check.evidence).toMatchObject({ repaired: 1 })
  })

  it('blocks with checker_missing when no checker is registered at run time', async () => {
    const output = envelope(['a'])
    const result = await evaluateCustomIntegrity(buildContext(output), buildRule())
    expect(result.blocked).toBe(true)
    expect(result.output).toBe(output)
    expect(result.check.result).toBe('block')
    expect(result.check.evidence).toMatchObject({ detail: CUSTOM_CHECKER_MISSING, checker: CHECKER_ID })
  })

  it.each([
    ['throws', () => { throw new Error('secret customer data in message') }],
    ['rejects', async () => { throw new Error('secret customer data in message') }],
    ['returns a malformed result', () => ({ violations: 'nope' }) as unknown as { violations: [] }],
  ])('blocks with checker_error when the checker %s, regardless of onViolation', async (_label, fn) => {
    register(fn as IntegrityCheckerFn)
    const result = await evaluateCustomIntegrity(buildContext(envelope(['a'])), buildRule({ onViolation: 'flag' }))
    expect(result.blocked).toBe(true)
    expect(result.check.result).toBe('block')
    expect(result.check.evidence).toMatchObject({ detail: CUSTOM_CHECKER_ERROR, violations: [] })
    expect(JSON.stringify(result.check)).not.toContain('secret')
  })

  it('coerces free-text reasons and malformed item paths so no checker text reaches evidence', async () => {
    register(() => ({
      violations: [
        { itemPath: 'data.items[0]', reason: 'The customer John Doe has no check' },
        { itemPath: 'data.items[*]', reason: 'UPPER' },
        { itemPath: 'John Doe', reason: 'x'.repeat(65) },
        { itemPath: 'data.items[0]', reason: 'scope:check.missing-1' },
      ],
    }))
    const result = await evaluateCustomIntegrity(buildContext(envelope(['a'])), buildRule())
    expect(result.check.evidence?.violations).toEqual([
      { itemPath: 'data.items[0]', reason: CUSTOM_INVALID_REASON },
      { itemPath: CUSTOM_UNADDRESSABLE_PATH, reason: CUSTOM_INVALID_REASON },
      { itemPath: CUSTOM_UNADDRESSABLE_PATH, reason: CUSTOM_INVALID_REASON },
      { itemPath: 'data.items[0]', reason: 'scope:check.missing-1' },
    ])
    expect(JSON.stringify(result.check)).not.toContain('John')
  })

  it('caps evidence at 20 violations and never records output content', async () => {
    const ids = Array.from({ length: 30 }, (_value, index) => `secret-${index}`)
    register(() => ({
      violations: ids.map((_id, index) => ({ itemPath: `data.items[${index}]`, reason: 'check_missing' })),
    }))
    const result = await evaluateCustomIntegrity(buildContext(envelope(ids)), buildRule({ onViolation: 'drop' }))
    expect(result.check.evidence?.violations).toHaveLength(20)
    expect(result.check.evidence).toMatchObject({ items: 30, dropped: 30 })
    expect((result.output as Envelope).data.items).toEqual([])
    expect(JSON.stringify(result.check)).not.toContain('secret')
    expect(Object.keys(result.check.evidence ?? {}).sort()).toEqual(
      ['ambiguous', 'checker', 'dropped', 'items', 'repaired', 'ruleId', 'violations'],
    )
  })
})

describe('custom rule in the output pipeline', () => {
  function runPipeline(rule: CustomIntegrityRule, rawObject: unknown) {
    return runOutputPipeline({
      entry: { schema, integrity: [rule] },
      rawObject,
      input: { content: 'deal summary' },
      toolCalls,
      citableSources,
      guardrailService: new GuardrailService({} as never),
      capability: 'test.agent',
      allowedTools: [],
      attemptedTools: [],
      guardrailSetVersion: 'i1-test',
      scope: { tenantId: 'tenant-1', organizationId: 'org-1' },
    })
  }

  it('forwards citable sources to the checker and returns the repaired output as final', async () => {
    const received: IntegrityCheckerInput[] = []
    register((input) => {
      received.push(input)
      return { violations: [], repairedOutput: envelope(['repaired']) }
    })
    const result = await runPipeline(buildRule(), envelope(['a']))
    expect(received[0].citableSources).toEqual(citableSources)
    expect(result.verdict.result).toBe('pass')
    expect(result.changed).toBe(true)
    expect(result.finalOutput).toEqual(envelope(['repaired']))
    expect(result.verdict.checks.map((check) => check.kind)).toEqual(['schema', 'custom_integrity', 'tool_scope'])
  })

  it('blocks a repaired output that breaks the result schema', async () => {
    register(() => ({ violations: [], repairedOutput: { kind: 'research', data: { items: 'broken' } } }))
    const result = await runPipeline(buildRule(), envelope(['a']))
    expect(result.verdict.result).toBe('block')
    expect(result.verdict.checks.at(-1)?.evidence).toEqual({ detail: INTEGRITY_REPAIR_INVALID })
  })

  it('blocks the run for an unknown checker without crashing', async () => {
    const result = await runPipeline(buildRule(), envelope(['a']))
    expect(result.verdict.result).toBe('block')
    expect(result.verdict.blockedReason).toEqual({ phase: 'output', kind: 'custom_integrity' })
    expect(result.finalOutput).toEqual(envelope(['a']))
  })

  it('blocks the run when the checker throws without crashing', async () => {
    register(() => {
      throw new Error('boom')
    })
    const result = await runPipeline(buildRule(), envelope(['a']))
    expect(result.verdict.result).toBe('block')
    expect(result.verdict.checks[1].evidence).toMatchObject({ detail: CUSTOM_CHECKER_ERROR })
  })
})
