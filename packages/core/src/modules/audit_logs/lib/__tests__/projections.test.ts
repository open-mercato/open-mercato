import {
  ACTION_LOG_CORRELATION_KEYS_MAX,
  deriveActionLogActionType,
  deriveActionLogCorrelationKeys,
  deriveActionLogProjection,
  deriveActionLogSource,
} from '../projections'

describe('audit log projections', () => {
  it('derives edit projections for dotted field changes', () => {
    const projection = deriveActionLogProjection({
      actorUserId: 'user-1',
      actionLabel: 'Update company',
      changes: {
        'entity.displayName': { old: 'Acme', new: 'Copperleaf' },
        status: { from: 'lead', to: 'customer' },
      },
      commandId: 'customers.companies.update',
      context: { source: 'ui' },
      snapshotBefore: { entity: { displayName: 'Acme' } },
    })

    expect(projection.actionType).toBe('edit')
    expect(projection.sourceKey).toBe('ui')
    expect(projection.changedFields).toEqual(['entity.displayName', 'status'])
    expect(projection.primaryChangedField).toBe('entity.displayName')
  })

  it('treats upsert actions as edits and normalizes fallback source', () => {
    expect(deriveActionLogActionType({
      actionLabel: 'Upsert adjustment',
      commandId: 'sales.orders.adjustments.upsert',
    })).toBe('edit')

    expect(deriveActionLogSource(null, null)).toBe('system')
    expect(deriveActionLogSource({}, 'user-1')).toBe('ui')
    expect(deriveActionLogSource({ source: 'API' }, null)).toBe('api')
  })

  it('derives the additive agent source key when context.source=agent (Wave 4 P2)', () => {
    // The runAs wrapper stamps `context.source = 'agent'`; the actor is the agent
    // principal id. Existing keys are unaffected (additive only).
    expect(deriveActionLogSource({ source: 'agent' }, 'agent-user-1')).toBe('agent')
    expect(deriveActionLogSource({ source: 'AGENT' }, 'agent-user-1')).toBe('agent')
    // Without the explicit source key, an actor still defaults to 'ui' — unchanged.
    expect(deriveActionLogSource({}, 'agent-user-1')).toBe('ui')
  })
})

describe('deriveActionLogCorrelationKeys', () => {
  it('returns no keys when the context has no correlation object', () => {
    expect(deriveActionLogCorrelationKeys(null)).toEqual([])
    expect(deriveActionLogCorrelationKeys({ source: 'agent' })).toEqual([])
    expect(deriveActionLogCorrelationKeys({ correlation: 'run-1' })).toEqual([])
    expect(deriveActionLogCorrelationKeys({ correlation: ['run-1'] })).toEqual([])
  })

  it('projects id-shaped string values as sorted key:value pairs', () => {
    expect(deriveActionLogCorrelationKeys({
      correlation: {
        proposalId: '7d3e0a52-8a5e-4c6f-9b1d-3f2a1c0e9b77',
        agentRunId: 'run_01H.x-9',
        correlationId: 'wf:instance-1',
      },
    })).toEqual([
      'agentRunId:run_01H.x-9',
      'correlationId:wf:instance-1',
      'proposalId:7d3e0a52-8a5e-4c6f-9b1d-3f2a1c0e9b77',
    ])
  })

  it('drops free text, non-string values and unsafe keys', () => {
    expect(deriveActionLogCorrelationKeys({
      correlation: {
        agentRunId: 'run-1',
        note: 'customer asked for a refund',
        email: 'someone@example.com',
        count: 3,
        nested: { id: 'x' },
        empty: '',
        tooLong: 'a'.repeat(129),
        'bad key': 'run-2',
        'a:b': 'run-3',
      },
    })).toEqual(['agentRunId:run-1'])
  })

  it('caps the projection at the maximum number of keys', () => {
    const correlation: Record<string, string> = {}
    for (let index = 0; index < 20; index += 1) {
      correlation[`key${String(index).padStart(2, '0')}`] = `id-${index}`
    }
    const keys = deriveActionLogCorrelationKeys({ correlation })
    expect(ACTION_LOG_CORRELATION_KEYS_MAX).toBe(16)
    expect(keys).toHaveLength(16)
    expect(keys[0]).toBe('key00:id-0')
    expect(keys[15]).toBe('key15:id-15')
  })

  it('is exposed on the combined projection', () => {
    const projection = deriveActionLogProjection({
      commandId: 'customers.deals.update',
      context: { source: 'agent', correlation: { agentRunId: 'run-1' } },
    })
    expect(projection.correlationKeys).toEqual(['agentRunId:run-1'])
  })
})
