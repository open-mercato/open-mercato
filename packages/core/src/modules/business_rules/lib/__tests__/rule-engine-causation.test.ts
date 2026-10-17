import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import {
  createCausationEnvelope,
  getAmbientCausation,
  isUuid,
  runWithCausation,
  type CausationEnvelope,
} from '@open-mercato/shared/lib/causation/server'
import * as ruleEngine from '../rule-engine'
import * as ruleEvaluator from '../rule-evaluator'
import * as actionExecutor from '../action-executor'
import type { ActionExecutionOutcome } from '../action-executor'
import type { RuleEngineContext } from '../rule-engine'
import type { BusinessRule } from '../../data/entities'
import { computeRuleDefinitionHash } from '../definition-hash'

jest.mock('../rule-evaluator')
jest.mock('../action-executor')

type CreatedLogRow = Record<string, unknown>

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'
const recordId = '00000000-0000-4000-8000-000000000003'
const ruleUuid = '11111111-1111-4111-8111-111111111111'
const stepInstanceId = '33333333-3333-4333-8333-333333333333'
const causedByLogId = '44444444-4444-4444-8444-444444444444'
const workflowInstanceId = '55555555-5555-4555-8555-555555555555'

const outcome: ActionExecutionOutcome = {
  success: true,
  results: [
    {
      action: { type: 'CALL_OPEN_MERCATO' },
      success: true,
      executionTime: 1,
    },
  ],
  totalTime: 1,
}

function buildRule(overrides: Partial<BusinessRule> = {}): BusinessRule {
  return {
    id: ruleUuid,
    ruleId: 'BR_CAUSATION_001',
    ruleName: 'Causation rule',
    ruleType: 'ACTION',
    entityType: 'customers.person',
    eventType: 'updated',
    conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
    successActions: [{ type: 'CALL_OPEN_MERCATO', config: { endpoint: '/api/customers/companies', method: 'PUT' } }],
    failureActions: [{ type: 'LOG', config: { message: 'not active' } }],
    enabled: true,
    priority: 100,
    version: 4,
    effectiveFrom: null,
    effectiveTo: null,
    tenantId,
    organizationId,
    ...overrides,
  } as BusinessRule
}

function buildContext(overrides: Partial<RuleEngineContext> = {}): RuleEngineContext {
  return {
    entityType: 'customers.person',
    entityId: recordId,
    eventType: 'updated',
    data: { id: recordId, status: 'ACTIVE' },
    tenantId,
    organizationId,
    ...overrides,
  }
}

function innermostRef(envelope: CausationEnvelope | null | undefined): string | null | undefined {
  return envelope ? envelope.frames[envelope.frames.length - 1].ref : undefined
}

function mockEvaluation(rule: BusinessRule, conditionsPassed: boolean): void {
  jest.mocked(ruleEvaluator.evaluateSingleRule).mockResolvedValue({
    rule,
    conditionsPassed,
    evaluationCompleted: true,
    evaluationTime: 1,
  })
}

describe('rule engine causation and run tracking', () => {
  let createdRows: CreatedLogRow[]
  let mockEm: jest.Mocked<EntityManager>
  let observedFrames: Array<CausationEnvelope | null>
  const previousCausationEnv = process.env.OM_CAUSATION

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_CAUSATION
    createdRows = []
    observedFrames = []
    mockEm = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((_entity: unknown, data: CreatedLogRow) => {
        const row = { id: String(createdRows.length + 1), ...data }
        createdRows.push(row)
        return row
      }),
      persist: jest.fn(function persist(this: unknown) { return this }),
      flush: jest.fn(async () => undefined),
    } as unknown as jest.Mocked<EntityManager>
    jest.mocked(actionExecutor.executeActions).mockImplementation(async () => {
      observedFrames.push(getAmbientCausation())
      return outcome
    })
  })

  afterEach(() => {
    if (previousCausationEnv === undefined) delete process.env.OM_CAUSATION
    else process.env.OM_CAUSATION = previousCausationEnv
  })

  test('runs actions inside a business_rule frame keyed by the rule UUID and a fresh run id', async () => {
    const rule = buildRule()
    mockEvaluation(rule, true)

    const result = await ruleEngine.executeSingleRule(mockEm, rule, buildContext())

    expect(isUuid(result.runId)).toBe(true)
    expect(observedFrames).toHaveLength(1)
    const envelope = observedFrames[0]
    expect(envelope).not.toBeNull()
    const innermost = envelope!.frames[envelope!.frames.length - 1]
    expect(innermost).toEqual({ kind: 'business_rule', id: ruleUuid, ref: result.runId })
    expect(innermost.id).not.toBe(rule.ruleId)
  })

  test('appends the rule frame to the ambient envelope and preserves its correlation id', async () => {
    const rule = buildRule()
    mockEvaluation(rule, true)
    const ambient = createCausationEnvelope([
      { kind: 'subscriber', id: 'business_rules:crud-rule-trigger', ref: 'customers.person.updated' },
    ])

    const result = await runWithCausation(ambient, () =>
      ruleEngine.executeSingleRule(mockEm, rule, buildContext()),
    )

    const envelope = observedFrames[0]
    expect(envelope?.correlationId).toBe(ambient.correlationId)
    expect(envelope?.frames).toEqual([
      { kind: 'subscriber', id: 'business_rules:crud-rule-trigger', ref: 'customers.person.updated' },
      { kind: 'business_rule', id: ruleUuid, ref: result.runId },
    ])
  })

  test('uses the failure action arm inside the same frame', async () => {
    const rule = buildRule()
    mockEvaluation(rule, false)

    const result = await ruleEngine.executeSingleRule(mockEm, rule, buildContext())

    expect(actionExecutor.executeActions).toHaveBeenCalledWith(rule.failureActions, expect.any(Object))
    const envelope = observedFrames[0]
    expect(envelope?.frames[envelope.frames.length - 1]).toEqual({ kind: 'business_rule', id: ruleUuid, ref: result.runId })
  })

  test('does not leak the rule frame outside the action execution', async () => {
    const rule = buildRule()
    mockEvaluation(rule, true)
    const ambient = createCausationEnvelope([{ kind: 'user' }])

    const after = await runWithCausation(ambient, async () => {
      await ruleEngine.executeSingleRule(mockEm, rule, buildContext())
      return getAmbientCausation()
    })

    expect(after?.frames).toEqual([{ kind: 'user' }])
    expect(getAmbientCausation()).toBeNull()
  })

  test('writes run id, rule version, definition hash and the triggering causation on the log row', async () => {
    const rule = buildRule()
    mockEvaluation(rule, true)
    const ambient = createCausationEnvelope([
      { kind: 'subscriber', id: 'business_rules:crud-rule-trigger', ref: 'customers.person.updated' },
    ])

    const result = await runWithCausation(ambient, () =>
      ruleEngine.executeSingleRule(mockEm, rule, buildContext()),
    )

    expect(result.logId).toBe('1')
    expect(createdRows).toHaveLength(1)
    const row = createdRows[0]
    expect(row.entityId).toBe(recordId)
    expect(row.runId).toBe(result.runId)
    expect(row.runId).toBe(observedFrames[0]?.frames[observedFrames[0].frames.length - 1].ref)
    expect(row.ruleVersion).toBe(4)
    expect(row.ruleDefinitionHash).toBe(computeRuleDefinitionHash(rule))
    expect(row.causationJson).toEqual({
      correlationId: ambient.correlationId,
      frames: [{ kind: 'subscriber', id: 'business_rules:crud-rule-trigger' }],
    })
  })

  test('stores identifier-only causation: frames reduced to kind, id and uuid refs, meta dropped', async () => {
    const rule = buildRule()
    mockEvaluation(rule, true)
    const ambient = {
      correlationId: '22222222-2222-4222-8222-222222222222',
      frames: [
        { kind: 'api_key', id: 'key-1', meta: { viaKeyId: 'key-2' } },
        { kind: 'workflow', id: 'instance-1', ref: stepInstanceId, meta: { workflowId: 'qa-flow', attempt: 2 } },
        { kind: 'subscriber', id: 'business_rules:crud-rule-trigger', ref: 'customers.person.updated' },
      ],
    } as unknown as CausationEnvelope

    await runWithCausation(ambient, () => ruleEngine.executeSingleRule(mockEm, rule, buildContext()))

    expect(createdRows[0].causationJson).toEqual({
      correlationId: '22222222-2222-4222-8222-222222222222',
      frames: [
        { kind: 'api_key', id: 'key-1' },
        { kind: 'workflow', id: 'instance-1', ref: stepInstanceId },
        { kind: 'subscriber', id: 'business_rules:crud-rule-trigger' },
      ],
    })
    expect(JSON.stringify(createdRows[0].causationJson)).not.toContain('meta')
  })

  test('drops unknown frames and marks the stored causation truncated', async () => {
    const rule = buildRule()
    mockEvaluation(rule, true)
    const ambient = {
      correlationId: '22222222-2222-4222-8222-222222222222',
      frames: [
        { kind: 'not_a_kind', id: 'dropped' },
        { kind: 'workflow', id: 'instance-1', ref: 'step-1', meta: { attempt: 2, payload: { secret: 'value' } } },
      ],
    } as unknown as CausationEnvelope

    await runWithCausation(ambient, () => ruleEngine.executeSingleRule(mockEm, rule, buildContext()))

    expect(createdRows[0].causationJson).toEqual({
      correlationId: '22222222-2222-4222-8222-222222222222',
      frames: [{ kind: 'workflow', id: 'instance-1' }],
      truncated: true,
    })
  })

  test('stores the causedByLogId of the triggering write', async () => {
    const rule = buildRule()
    mockEvaluation(rule, true)
    const ambient = createCausationEnvelope([{ kind: 'user' }], { causedByLogId })

    await runWithCausation(ambient, () => ruleEngine.executeSingleRule(mockEm, rule, buildContext()))

    expect(createdRows[0].causationJson).toEqual({
      correlationId: ambient.correlationId,
      frames: [{ kind: 'user' }],
      causedByLogId,
    })
  })

  test('records null causation when no ambient envelope exists', async () => {
    const rule = buildRule()
    mockEvaluation(rule, true)

    const result = await ruleEngine.executeSingleRule(mockEm, rule, buildContext())

    expect(createdRows[0].causationJson).toBeNull()
    expect(createdRows[0].runId).toBe(result.runId)
  })

  test('falls back to the unknown entity id when the context has none', async () => {
    const rule = buildRule()
    mockEvaluation(rule, true)

    await ruleEngine.executeSingleRule(mockEm, rule, buildContext({ entityId: undefined }))

    expect(createdRows[0].entityId).toBe('unknown')
  })

  test('generates a distinct run id per execution', async () => {
    const rule = buildRule()
    mockEvaluation(rule, true)

    const first = await ruleEngine.executeSingleRule(mockEm, rule, buildContext())
    const second = await ruleEngine.executeSingleRule(mockEm, rule, buildContext())

    expect(first.runId).not.toBe(second.runId)
    expect(createdRows.map((row) => row.runId)).toEqual([first.runId, second.runId])
  })

  test('dryRun still runs actions in the frame but writes no log row', async () => {
    const rule = buildRule()
    mockEvaluation(rule, true)

    const result = await ruleEngine.executeSingleRule(mockEm, rule, buildContext({ dryRun: true }))

    expect(actionExecutor.executeActions).toHaveBeenCalledTimes(1)
    expect(observedFrames[0]?.frames[observedFrames[0].frames.length - 1].ref).toBe(result.runId)
    expect(mockEm.create).not.toHaveBeenCalled()
    expect(result.logId).toBeUndefined()
  })

  test('skipActions runs no actions but still logs the run when not a dry run', async () => {
    const rule = buildRule()
    mockEvaluation(rule, true)

    const result = await ruleEngine.executeSingleRule(mockEm, rule, buildContext({ skipActions: true }))

    expect(actionExecutor.executeActions).not.toHaveBeenCalled()
    expect(result.actionsExecuted).toBeNull()
    expect(createdRows).toHaveLength(1)
    expect(createdRows[0].runId).toBe(result.runId)
    expect(createdRows[0].outputContext).toBeNull()
  })

  test('skipActions with dryRun produces neither actions nor a log row', async () => {
    const rule = buildRule()
    mockEvaluation(rule, true)

    const result = await ruleEngine.executeSingleRule(mockEm, rule, buildContext({ dryRun: true, skipActions: true }))

    expect(actionExecutor.executeActions).not.toHaveBeenCalled()
    expect(mockEm.create).not.toHaveBeenCalled()
    expect(isUuid(result.runId)).toBe(true)
  })

  test('logs the run id on incomplete evaluations', async () => {
    const rule = buildRule()
    jest.mocked(ruleEvaluator.evaluateSingleRule).mockResolvedValue({
      rule,
      conditionsPassed: false,
      evaluationCompleted: false,
      evaluationTime: 1,
      error: 'Evaluation error',
    })

    const result = await ruleEngine.executeSingleRule(mockEm, rule, buildContext())

    expect(actionExecutor.executeActions).not.toHaveBeenCalled()
    expect(createdRows[0].executionResult).toBe('ERROR')
    expect(createdRows[0].runId).toBe(result.runId)
  })

  test('logs the run id when action execution throws', async () => {
    const rule = buildRule()
    mockEvaluation(rule, true)
    jest.mocked(actionExecutor.executeActions).mockRejectedValue(new Error('loopback failed'))

    const result = await ruleEngine.executeSingleRule(mockEm, rule, buildContext())

    expect(result.error).toContain('loopback failed')
    expect(createdRows[0].executionResult).toBe('ERROR')
    expect(createdRows[0].runId).toBe(result.runId)
  })

  test('skips the frame and causation capture when OM_CAUSATION is off', async () => {
    process.env.OM_CAUSATION = 'off'
    const rule = buildRule()
    mockEvaluation(rule, true)
    const ambient = createCausationEnvelope([{ kind: 'user' }])

    const result = await runWithCausation(ambient, () =>
      ruleEngine.executeSingleRule(mockEm, rule, buildContext()),
    )

    expect(observedFrames[0]?.frames).toEqual([{ kind: 'user' }])
    expect(createdRows[0].causationJson).toBeNull()
    expect(createdRows[0].runId).toBe(result.runId)
    expect(createdRows[0].ruleDefinitionHash).toBe(computeRuleDefinitionHash(rule))
  })

  test('executeRuleById exposes the run id of the logged execution', async () => {
    const rule = buildRule()
    mockEvaluation(rule, true)
    mockEm.findOne.mockResolvedValue(rule)

    const result = await ruleEngine.executeRuleById(mockEm, {
      ruleId: ruleUuid,
      data: { status: 'ACTIVE' },
      tenantId,
      organizationId,
      entityId: recordId,
    })

    expect(result.success).toBe(true)
    expect(isUuid(result.runId)).toBe(true)
    expect(createdRows[0].runId).toBe(result.runId)
    expect(createdRows[0].entityId).toBe(recordId)
  })

  test('executeRuleByRuleId exposes the run id of the logged execution', async () => {
    const rule = buildRule()
    mockEvaluation(rule, true)
    mockEm.findOne.mockResolvedValue(rule)

    const result = await ruleEngine.executeRuleByRuleId(mockEm, {
      ruleId: rule.ruleId,
      data: { status: 'ACTIVE' },
      tenantId,
      organizationId,
      entityId: recordId,
    })

    expect(result.success).toBe(true)
    expect(isUuid(result.runId)).toBe(true)
    expect(createdRows).toHaveLength(1)
    expect(createdRows[0].runId).toBe(result.runId)
    expect(innermostRef(observedFrames[0])).toBe(result.runId)
  })

  test('executeRuleByRuleId returns no run id when the rule cannot be found', async () => {
    mockEm.findOne.mockResolvedValue(null)

    const result = await ruleEngine.executeRuleByRuleId(mockEm, {
      ruleId: 'MISSING_RULE',
      data: {},
      tenantId,
      organizationId,
    })

    expect(result.success).toBe(false)
    expect(result.runId).toBeUndefined()
    expect(createdRows).toHaveLength(0)
  })

  test('runs a workflow post-condition guard rule\'s actions in the rule frame stacked on the workflow frame', async () => {
    const rule = buildRule({
      ruleId: 'QA_POST_GUARD',
      ruleType: 'GUARD',
      entityType: 'workflow:qa-flow:transition',
      eventType: 'post_transition',
    })
    mockEvaluation(rule, true)
    mockEm.findOne.mockResolvedValue(rule)
    const workflowFrame = { kind: 'workflow' as const, id: workflowInstanceId, meta: { workflowId: 'qa-flow' } }
    const ambient = createCausationEnvelope([{ kind: 'user' }, workflowFrame])

    const result = await runWithCausation(ambient, () =>
      ruleEngine.executeRuleByRuleId(mockEm, {
        ruleId: rule.ruleId,
        data: { workflowInstanceId, workflowId: 'qa-flow' },
        tenantId,
        organizationId,
        entityType: 'workflow:qa-flow:transition',
        entityId: 'step-1-to-step-2',
        eventType: 'post_transition',
      }),
    )

    expect(result.success).toBe(true)
    expect(actionExecutor.executeActions).toHaveBeenCalledWith(rule.successActions, expect.any(Object))
    expect(observedFrames).toEqual([
      {
        correlationId: ambient.correlationId,
        frames: [{ kind: 'user' }, workflowFrame, { kind: 'business_rule', id: ruleUuid, ref: result.runId }],
      },
    ])
    expect(createdRows[0].runId).toBe(result.runId)
    expect(createdRows[0].entityId).toBe('step-1-to-step-2')
    expect(createdRows[0].causationJson).toEqual({
      correlationId: ambient.correlationId,
      frames: [{ kind: 'user' }, { kind: 'workflow', id: workflowInstanceId }],
    })
  })
})

describe('logRuleExecution run metadata', () => {
  const tenant = '00000000-0000-4000-8000-000000000011'
  const organization = '00000000-0000-4000-8000-000000000012'

  function buildEm(rows: CreatedLogRow[]): EntityManager {
    return {
      create: jest.fn((_entity: unknown, data: CreatedLogRow) => {
        const row = { id: 'log-9', ...data }
        rows.push(row)
        return row
      }),
      persist: jest.fn(function persist(this: unknown) { return this }),
      flush: jest.fn(async () => undefined),
    } as unknown as EntityManager
  }

  test('ignores a non-UUID run id and a non-integer version', async () => {
    const rows: CreatedLogRow[] = []
    const rule = buildRule({ version: undefined as unknown as number })

    await ruleEngine.logRuleExecution(buildEm(rows), {
      rule,
      context: buildContext({ tenantId: tenant, organizationId: organization }),
      conditionResult: true,
      actionsExecuted: null,
      executionTime: 3,
      runId: 'not-a-uuid',
    })

    expect(rows[0].runId).toBeNull()
    expect(rows[0].ruleVersion).toBeNull()
    expect(rows[0].ruleDefinitionHash).toBe(computeRuleDefinitionHash(rule))
  })

  test('keeps legacy callers without a run id working', async () => {
    const rows: CreatedLogRow[] = []
    const rule = buildRule({ version: 2 })

    const logId = await ruleEngine.logRuleExecution(buildEm(rows), {
      rule,
      context: buildContext({ tenantId: tenant, organizationId: organization }),
      conditionResult: false,
      actionsExecuted: null,
      executionTime: 3,
    })

    expect(logId).toBe('log-9')
    expect(rows[0]).toMatchObject({
      runId: null,
      ruleVersion: 2,
      executionResult: 'FAILURE',
      causationJson: null,
    })
  })
})
