import {
  processDefinitionCreateSchema,
  processExecutionStartSchema,
  processTriggerSchema,
} from '../data/validators'
import {
  evaluateFilterConditions,
  mapEventToInput,
  matchesEventPattern,
} from '../lib/tasks/eventTriggerMatch'

describe('processDefinitionCreateSchema', () => {
  const singleAgent = { agentId: 'deals.health_check', onResult: { alwaysAsk: true as const } }
  const base = { name: 'Deal health check', workflowMode: 'single_agent' as const }

  it('requires the agent that single-agent mode generates its workflow from', () => {
    expect(processDefinitionCreateSchema.safeParse(base).success).toBe(false)
    expect(processDefinitionCreateSchema.safeParse({ ...base, singleAgent }).success).toBe(true)
  })

  it('requires an existing workflow id in workflow mode', () => {
    expect(
      processDefinitionCreateSchema.safeParse({ name: 'X', workflowMode: 'workflow' }).success,
    ).toBe(false)
    expect(
      processDefinitionCreateSchema.safeParse({
        name: 'X',
        workflowMode: 'workflow',
        workflowId: 'claims_resolution',
      }).success,
    ).toBe(true)
  })

  it('accepts milestones in BOTH modes — a milestone is a business event, not a step', () => {
    const milestones = [{ key: 'analysis_completed', label: 'Analysis completed', order: 0 }]
    expect(processDefinitionCreateSchema.safeParse({ ...base, singleAgent, milestones }).success).toBe(true)
    expect(
      processDefinitionCreateSchema.safeParse({
        name: 'X',
        workflowMode: 'workflow',
        workflowId: 'claims_resolution',
        milestones,
      }).success,
    ).toBe(true)
  })

  it('rejects malformed cron expressions and accepts 5-field ones', () => {
    const withCron = (cron: string) =>
      processDefinitionCreateSchema.safeParse({
        ...base,
        singleAgent,
        triggers: [{ kind: 'schedule', cron }],
      })
    expect(withCron('0 7 * * *').success).toBe(true)
    expect(withCron('0 7 * * * *').success).toBe(true)
    expect(withCron('every morning').success).toBe(false)
    expect(withCron('* *').success).toBe(false)
  })
})

describe('processExecutionStartSchema', () => {
  it('accepts an empty body and rejects a non-uuid sourceEntityId', () => {
    expect(processExecutionStartSchema.safeParse({}).success).toBe(true)
    expect(processExecutionStartSchema.safeParse({ sourceEntityId: 'claim-1' }).success).toBe(false)
    expect(
      processExecutionStartSchema.safeParse({
        input: { claimId: 'x' },
        idempotencyKey: 'settle-2026-07-12',
        sourceEntityType: 'claims:claim',
        sourceEntityId: '33333333-3333-4333-8333-333333333333',
      }).success,
    ).toBe(true)
  })
})

describe('processTriggerSchema — event arm', () => {
  const event = (extra: Record<string, unknown>) =>
    processTriggerSchema.safeParse({ kind: 'event', ...extra })

  it('accepts exact ids and trailing wildcards, rejects junk', () => {
    expect(event({ eventPattern: 'claims.claim.reported' }).success).toBe(true)
    expect(event({ eventPattern: 'claims.*' }).success).toBe(true)
    expect(event({ eventPattern: 'not an event!!' }).success).toBe(false)
  })

  it('rejects unknown config keys (strict shape)', () => {
    expect(event({ eventPattern: 'claims.claim.reported', config: { unknownKey: true } }).success).toBe(false)
    expect(
      event({
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
