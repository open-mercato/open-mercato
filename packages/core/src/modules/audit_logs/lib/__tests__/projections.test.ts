import {
  deriveActionLogActionType,
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
