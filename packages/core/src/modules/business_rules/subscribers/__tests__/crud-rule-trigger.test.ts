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

  function makeCtx(
    eventName?: string,
    scope: { tenantId?: string | null; organizationId?: string | null } = {
      tenantId: 't1',
      organizationId: 'o1',
    },
  ) {
    return {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return mockEm
        return null
      }),
      eventName,
      ...scope,
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

  it('calls executeRules for a CRUD event with trusted subscriber context scope', async () => {
    await handler(
      { id: 'person-1' },
      makeCtx('customers.person.created'),
    )
    expect(executeRulesMock).toHaveBeenCalledWith(mockEm, {
      entityType: 'customers.person',
      eventType: 'created',
      data: { id: 'person-1' },
      tenantId: 't1',
      organizationId: 'o1',
    })
  })

  it('does not trust payload tenant scope over subscriber context scope', async () => {
    await handler(
      { tenantId: 'spoofed-tenant', organizationId: 'spoofed-org', id: 'person-1' },
      makeCtx('customers.person.created', { tenantId: 'trusted-tenant', organizationId: 'trusted-org' }),
    )
    expect(executeRulesMock).toHaveBeenCalledWith(mockEm, expect.objectContaining({
      data: { tenantId: 'spoofed-tenant', organizationId: 'spoofed-org', id: 'person-1' },
      tenantId: 'trusted-tenant',
      organizationId: 'trusted-org',
    }))
  })

  it('skips excluded internal events', async () => {
    for (const event of ['query_index.updated', 'search.reindex', 'cache.invalidated', 'business_rules.rule.created', 'workflows.instance.completed']) {
      await handler({}, makeCtx(event))
    }
    expect(executeRulesMock).not.toHaveBeenCalled()
  })

  it('skips events without trusted tenantId or organizationId context', async () => {
    await handler({ tenantId: 't1', organizationId: 'o1' }, makeCtx('customers.person.created', { tenantId: 't1' }))
    await handler({ tenantId: 't1', organizationId: 'o1' }, makeCtx('customers.person.created', { organizationId: 'o1' }))
    await handler({ tenantId: 't1', organizationId: 'o1' }, makeCtx('customers.person.created', {}))
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
