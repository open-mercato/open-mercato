import {
  agentTaskDefinitionCreateSchema,
  agentTaskEventTriggerCreateSchema,
  agentTaskRunRequestSchema,
} from '../data/validators'
import {
  evaluateFilterConditions,
  mapEventToInput,
  matchesEventPattern,
} from '../lib/tasks/eventTriggerMatch'

describe('agentTaskDefinitionCreateSchema', () => {
  const base = { name: 'Deal health check', targetType: 'agent' as const }

  it('requires a target agent id for agent targets', () => {
    expect(agentTaskDefinitionCreateSchema.safeParse(base).success).toBe(false)
    expect(
      agentTaskDefinitionCreateSchema.safeParse({ ...base, targetAgentId: 'deals.health_check' }).success,
    ).toBe(true)
  })

  it('requires a target workflow id for workflow targets', () => {
    expect(
      agentTaskDefinitionCreateSchema.safeParse({ name: 'X', targetType: 'workflow' }).success,
    ).toBe(false)
    expect(
      agentTaskDefinitionCreateSchema.safeParse({
        name: 'X',
        targetType: 'workflow',
        targetWorkflowId: 'claims_resolution',
      }).success,
    ).toBe(true)
  })

  it('rejects malformed cron expressions and accepts 5-field ones', () => {
    const withCron = (cron: string) =>
      agentTaskDefinitionCreateSchema.safeParse({ ...base, targetAgentId: 'a', scheduleCron: cron })
    expect(withCron('0 7 * * *').success).toBe(true)
    expect(withCron('0 7 * * * *').success).toBe(true)
    expect(withCron('every morning').success).toBe(false)
    expect(withCron('* *').success).toBe(false)
  })
})

describe('agentTaskRunRequestSchema', () => {
  it('accepts an empty body and rejects a non-uuid sourceEntityId', () => {
    expect(agentTaskRunRequestSchema.safeParse({}).success).toBe(true)
    expect(agentTaskRunRequestSchema.safeParse({ sourceEntityId: 'claim-1' }).success).toBe(false)
    expect(
      agentTaskRunRequestSchema.safeParse({
        input: { claimId: 'x' },
        idempotencyKey: 'settle-2026-07-12',
        sourceEntityType: 'claims:claim',
        sourceEntityId: '33333333-3333-4333-8333-333333333333',
      }).success,
    ).toBe(true)
  })
})

describe('agentTaskEventTriggerCreateSchema', () => {
  it('accepts exact ids and trailing wildcards, rejects junk', () => {
    expect(agentTaskEventTriggerCreateSchema.safeParse({ eventPattern: 'claims.claim.reported' }).success).toBe(true)
    expect(agentTaskEventTriggerCreateSchema.safeParse({ eventPattern: 'claims.*' }).success).toBe(true)
    expect(agentTaskEventTriggerCreateSchema.safeParse({ eventPattern: 'not an event!!' }).success).toBe(false)
  })

  it('rejects unknown config keys (strict shape)', () => {
    expect(
      agentTaskEventTriggerCreateSchema.safeParse({
        eventPattern: 'claims.claim.reported',
        config: { unknownKey: true },
      }).success,
    ).toBe(false)
    expect(
      agentTaskEventTriggerCreateSchema.safeParse({
        eventPattern: 'claims.claim.reported',
        config: {
          filterConditions: [{ field: 'status', operator: 'eq', value: 'open' }],
          contextMapping: [{ targetKey: 'claimId', sourceExpression: 'id' }],
          debounceMs: 5000,
          maxConcurrentInstances: 3,
        },
      }).success,
    ).toBe(true)
  })
})

describe('eventTriggerMatch', () => {
  it('matches exact patterns and trailing wildcards only', () => {
    expect(matchesEventPattern('claims.claim.reported', 'claims.claim.reported')).toBe(true)
    expect(matchesEventPattern('claims.*', 'claims.claim.reported')).toBe(true)
    expect(matchesEventPattern('claims.*', 'customers.deal.created')).toBe(false)
    expect(matchesEventPattern('claims.claim.reported', 'claims.claim.updated')).toBe(false)
  })

  it('evaluates filter conditions with AND logic over nested paths', () => {
    const payload = { status: 'open', amount: 1200, meta: { region: 'EU' } }
    expect(
      evaluateFilterConditions(
        [
          { field: 'status', operator: 'eq', value: 'open' },
          { field: 'amount', operator: 'gt', value: 1000 },
          { field: 'meta.region', operator: 'in', value: ['EU', 'US'] },
        ],
        payload,
      ),
    ).toBe(true)
    expect(
      evaluateFilterConditions([{ field: 'status', operator: 'neq', value: 'open' }], payload),
    ).toBe(false)
    expect(evaluateFilterConditions(undefined, payload)).toBe(true)
  })

  it('maps event payload into run input with defaults', () => {
    expect(
      mapEventToInput(
        [
          { targetKey: 'claimId', sourceExpression: 'id' },
          { targetKey: 'priority', sourceExpression: 'meta.priority', defaultValue: 'normal' },
        ],
        { id: 'claim-9', meta: {} },
      ),
    ).toEqual({ claimId: 'claim-9', priority: 'normal' })
    expect(mapEventToInput(undefined, { id: 'x' })).toEqual({})
  })
})
