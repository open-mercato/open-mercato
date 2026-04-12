import handler, { metadata } from '../crud-rule-trigger'

jest.mock('../../lib/rule-engine', () => ({
  executeRules: jest.fn(async () => ({
    allowed: true,
    executedRules: [],
    totalExecutionTime: 0,
    errors: [],
  })),
}))

import { executeRules } from '../../lib/rule-engine'
const executeRulesMock = executeRules as jest.MockedFunction<typeof executeRules>

describe('business_rules crud-rule-trigger subscriber', () => {
  const mockEm = {} as any

  function makeCtx(eventName?: string) {
    return {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return mockEm
        return null
      }),
      eventName,
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('has wildcard event subscription with persistent flag', () => {
    expect(metadata.event).toBe('*')
    expect(metadata.persistent).toBe(true)
    expect(metadata.id).toBe('business_rules:crud-rule-trigger')
  })

  it('calls executeRules for a CRUD event with tenant scope', async () => {
    await handler(
      { tenantId: 't1', organizationId: 'o1', id: 'person-1' },
      makeCtx('customers.person.created'),
    )
    expect(executeRulesMock).toHaveBeenCalledWith(mockEm, {
      entityType: 'customers.person',
      eventType: 'created',
      data: { tenantId: 't1', organizationId: 'o1', id: 'person-1' },
      tenantId: 't1',
      organizationId: 'o1',
    })
  })

  it('skips excluded internal events', async () => {
    for (const event of ['query_index.updated', 'search.reindex', 'cache.invalidated', 'business_rules.rule.created', 'workflows.instance.completed']) {
      await handler({ tenantId: 't1', organizationId: 'o1' }, makeCtx(event))
    }
    expect(executeRulesMock).not.toHaveBeenCalled()
  })

  it('skips events without tenantId or organizationId', async () => {
    await handler({ tenantId: 't1' }, makeCtx('customers.person.created'))
    await handler({ organizationId: 'o1' }, makeCtx('customers.person.created'))
    await handler({}, makeCtx('customers.person.created'))
    expect(executeRulesMock).not.toHaveBeenCalled()
  })

  it('skips when eventName is missing', async () => {
    await handler({ tenantId: 't1', organizationId: 'o1' }, makeCtx(undefined))
    expect(executeRulesMock).not.toHaveBeenCalled()
  })

  it('skips events with fewer than 3 dot-separated parts', async () => {
    await handler({ tenantId: 't1', organizationId: 'o1' }, makeCtx('system.ping'))
    expect(executeRulesMock).not.toHaveBeenCalled()
  })

  it('does not throw when executeRules fails', async () => {
    executeRulesMock.mockRejectedValueOnce(new Error('DB down'))
    await expect(
      handler({ tenantId: 't1', organizationId: 'o1' }, makeCtx('sales.order.created')),
    ).resolves.toBeUndefined()
  })
})
