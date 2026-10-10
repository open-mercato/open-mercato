import {
  SIMULATION_EVENT_ID_PATTERN,
  SIMULATION_KIND_PATTERN,
  createCrudEventAdapters,
  defineSimulateConfig,
  simulationEventEntityType,
  simulationEventType,
  type SimulationAuditEntry,
} from '../simulate'

const SCOPE = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

function entry(overrides: Partial<SimulationAuditEntry> = {}): SimulationAuditEntry {
  return {
    logId: '33333333-3333-4333-8333-333333333333',
    at: '2026-10-01T10:00:00.000Z',
    commandId: 'test.things.update',
    actionType: 'edit',
    executionState: 'done',
    actorUserId: null,
    resourceKind: 'test.thing',
    resourceId: 'thing-1',
    snapshotBefore: null,
    snapshotAfter: null,
    changes: null,
    causeKind: 'user',
    organizationId: SCOPE.organizationId,
    correlationId: null,
    causedByLogId: null,
    actorKind: 'user',
    ...overrides,
  }
}

describe('change simulator contract', () => {
  it('keeps the config as declared', () => {
    const config = defineSimulateConfig({ version: 1, eventAdapters: [] })
    expect(config).toEqual({ version: 1, eventAdapters: [] })
    expect(SIMULATION_KIND_PATTERN.test('business_rules.rule_backtest')).toBe(true)
    expect(SIMULATION_KIND_PATTERN.test('rule_backtest')).toBe(false)
    expect(SIMULATION_EVENT_ID_PATTERN.test('customers.deal.updated')).toBe(true)
    expect(SIMULATION_EVENT_ID_PATTERN.test('customers.deal')).toBe(false)
    expect(simulationEventEntityType('customers.person.company_assignment.detached')).toBe('customers.person.company_assignment')
    expect(simulationEventType('customers.deal.updated')).toBe('updated')
  })

  it('builds the generated CRUD payload from an audit entry', () => {
    const [created, updated, deleted] = createCrudEventAdapters({ eventPrefix: 'test.thing', logResourceKinds: ['test.thing'], requiredFeatures: ['test.things.view'] })
    expect([created.eventId, updated.eventId, deleted.eventId]).toEqual(['test.thing.created', 'test.thing.updated', 'test.thing.deleted'])
    expect([created.actionTypes, updated.actionTypes, deleted.actionTypes]).toEqual([['create'], ['edit'], ['delete']])
    expect(updated.requiredFeatures).toEqual(['test.things.view'])
    expect(updated.payloadFrom(entry(), { scope: SCOPE })).toEqual({ payload: { id: 'thing-1', organizationId: SCOPE.organizationId, tenantId: SCOPE.tenantId } })
  })

  it('declares syncOrigin unknown whenever the write could come from a sync', () => {
    const [adapter] = createCrudEventAdapters({ eventPrefix: 'test.thing', logResourceKinds: ['test.thing'], requiredFeatures: ['test.things.view'], actions: ['updated'] })
    for (const causeKind of ['sync_run', 'subscriber', 'schedule', 'system', 'unknown', null] as const) {
      expect(adapter.payloadFrom(entry({ causeKind }), { scope: SCOPE })?.unknownPaths).toEqual(['syncOrigin'])
    }
    const [noSync] = createCrudEventAdapters({ eventPrefix: 'test.thing', logResourceKinds: ['test.thing'], requiredFeatures: ['test.things.view'], actions: ['updated'], syncOrigin: false })
    expect(noSync.payloadFrom(entry({ causeKind: 'sync_run' }), { scope: SCOPE })?.unknownPaths).toBeUndefined()
  })

  it('skips undo traces, failed entries and entries without a record id', () => {
    const [adapter] = createCrudEventAdapters({ eventPrefix: 'test.thing', logResourceKinds: ['test.thing'], requiredFeatures: ['test.things.view'], actions: ['created'] })
    expect(adapter.payloadFrom(entry({ causeKind: 'undo' }), { scope: SCOPE })).toBeNull()
    expect(adapter.payloadFrom(entry({ executionState: 'failed' }), { scope: SCOPE })).toBeNull()
    expect(adapter.payloadFrom(entry({ resourceId: ' ' }), { scope: SCOPE })).toBeNull()
  })

  it('narrows actions to command ids and merges extra identifier fields', () => {
    const [adapter] = createCrudEventAdapters({
      eventPrefix: 'test.thing',
      logResourceKinds: ['test.thing'],
      requiredFeatures: ['test.things.view'],
      actions: ['created'],
      commandIds: { created: ['test.things.create'] },
      syncOrigin: false,
      extraPayload: (source) => ({ payload: { userId: source.actorUserId }, unknownPaths: source.actorUserId ? [] : ['userId'], valuePaths: ['userId'] }),
    })
    expect(adapter.commandIds).toEqual(['test.things.create'])
    expect(adapter.payloadFrom(entry({ actorUserId: 'user-1' }), { scope: SCOPE })).toEqual({
      payload: { id: 'thing-1', organizationId: SCOPE.organizationId, tenantId: SCOPE.tenantId, userId: 'user-1' },
      valuePaths: ['userId'],
    })
    expect(adapter.payloadFrom(entry(), { scope: SCOPE })?.unknownPaths).toEqual(['userId'])
  })
})
