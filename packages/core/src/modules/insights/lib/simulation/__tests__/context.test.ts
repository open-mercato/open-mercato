import { SimulationFeatureCheckError, applyPastValuePolicy, createFeatureCheck, toSimulationAuditEntry, withPastValuePolicy } from '../context'

const SCOPE = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

describe('simulation run context helpers', () => {
  it('turns past record values into unknown paths without audit_logs.view_tenant', () => {
    const rebuilt = { payload: { id: 'deal-1', title: 'Big deal', nested: { value: 10 } }, valuePaths: ['title', 'nested.value'] }
    expect(applyPastValuePolicy(rebuilt, true)).toBe(rebuilt)
    const stripped = applyPastValuePolicy(rebuilt, false)
    expect(stripped.payload).toEqual({ id: 'deal-1', nested: {} })
    expect(stripped.unknownPaths).toEqual(['title', 'nested.value'])
    expect(rebuilt.payload.title).toBe('Big deal')
  })

  it('wraps adapters with the policy', () => {
    const [wrapped] = withPastValuePolicy([{
      moduleId: 'customers',
      eventId: 'customers.deal.won',
      logResourceKinds: ['customers.deal'],
      actionTypes: ['edit'],
      payloadFrom: () => ({ payload: { id: 'd', title: 'x' }, unknownPaths: ['ownerUserId'], valuePaths: ['title'] }),
    }], false)
    expect(wrapped.payloadFrom({} as never, { scope: SCOPE })).toEqual({ payload: { id: 'd' }, unknownPaths: ['ownerUserId', 'title'], valuePaths: [] })
  })

  it('checks features wildcard-aware through rbacService, memoized, and fails closed without the service', async () => {
    const userHasAllFeatures = jest.fn(async (_userId: string, required: string[]) => !required.includes('denied.feature'))
    const check = createFeatureCheck({ resolve: () => ({ userHasAllFeatures }) }, 'user-1', SCOPE)
    await expect(check(['b.view', 'a.view'])).resolves.toBe(true)
    await expect(check(['a.view', 'b.view'])).resolves.toBe(true)
    expect(userHasAllFeatures).toHaveBeenCalledTimes(1)
    expect(userHasAllFeatures).toHaveBeenCalledWith('user-1', ['a.view', 'b.view'], SCOPE)
    await expect(check(['denied.feature'])).resolves.toBe(false)
    await expect(check([])).resolves.toBe(true)
    const missing = createFeatureCheck({ resolve: () => { throw new Error('missing') } }, 'user-1', SCOPE)
    await expect(missing(['a.view'])).resolves.toBe(false)
  })

  it('reports a failing RBAC service as an error, never as a denial, and does not memoize it', async () => {
    const userHasAllFeatures = jest.fn(async () => true).mockRejectedValueOnce(new Error('db'))
    const failing = createFeatureCheck({ resolve: () => ({ userHasAllFeatures }) }, 'user-1', SCOPE)
    await expect(failing(['a.view'])).rejects.toBeInstanceOf(SimulationFeatureCheckError)
    await expect(failing(['a.view'])).resolves.toBe(true)
    expect(userHasAllFeatures).toHaveBeenCalledTimes(2)
  })

  it('maps scanned audit entries to the adapter shape', () => {
    const entry = toSimulationAuditEntry({
      logId: 'log-1',
      at: '2026-10-01T10:00:00.000Z',
      cursorAt: '2026-10-01T10:00:00.000000Z',
      commandId: 'customers.deals.update',
      actionType: 'edit',
      executionState: 'done',
      actorUserId: 'user-1',
      resourceKind: 'customers.deal',
      resourceId: 'deal-1',
      changedFields: ['status'],
      snapshotBefore: { deal: { status: 'open' } },
      snapshotAfter: { deal: { status: 'win' } },
      changes: null,
      causeKind: 'user',
      causeId: null,
      organizationId: SCOPE.organizationId,
      actionLabel: null,
      onBehalfOfUserId: null,
      parentResourceKind: null,
      parentResourceId: null,
      correlationId: 'corr-1',
      causedByLogId: null,
      causation: null,
      historyAction: null,
      sourceLogId: null,
      actorKind: 'user',
    })
    expect(entry).toEqual(expect.objectContaining({ logId: 'log-1', resourceId: 'deal-1', correlationId: 'corr-1', actorKind: 'user', organizationId: SCOPE.organizationId }))
    expect(entry).not.toHaveProperty('cursorAt')
  })
})
