import type { EntityManager } from '@mikro-orm/core'
import handler, { metadata } from '../crud-rule-trigger'

const mockReportError = jest.fn()
const mockReportCausationDegradation = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/telemetry/runtime'),
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

jest.mock('@open-mercato/shared/lib/causation/server', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/causation/server'),
  reportCausationDegradation: (...args: unknown[]) => mockReportCausationDegradation(...args),
}))

jest.mock('../../lib/rule-engine', () => ({
  executeRules: jest.fn(async () => ({
    allowed: true,
    executedRules: [],
    totalExecutionTime: 0,
    errors: [],
  })),
  resolveBusinessRuleDiscoveryCache: jest.fn(() => null),
}))

import { executeRules, resolveBusinessRuleDiscoveryCache } from '../../lib/rule-engine'
const executeRulesMock = executeRules as jest.MockedFunction<typeof executeRules>
const resolveBusinessRuleDiscoveryCacheMock = resolveBusinessRuleDiscoveryCache as jest.MockedFunction<typeof resolveBusinessRuleDiscoveryCache>

describe('business_rules crud-rule-trigger subscriber', () => {
  const mockEm = {} as EntityManager

  function makeCtx(
    eventName?: string,
    scope: { tenantId?: string | null; organizationId?: string | null } = {
      tenantId: 't1',
      organizationId: 'o1',
    },
  ) {
    function resolve<T = unknown>(name: string): T {
      return (name === 'em' ? mockEm : null) as T
    }
    return {
      resolve,
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
      entityId: 'person-1',
      data: { id: 'person-1' },
      tenantId: 't1',
      organizationId: 'o1',
    }, { cache: null })
    expect(resolveBusinessRuleDiscoveryCacheMock).toHaveBeenCalled()
  })

  it('falls back to payload entityId when id is missing', async () => {
    await handler({ entityId: 'entity-7' }, makeCtx('customers.person.updated'))
    expect(executeRulesMock.mock.calls[0][1].entityId).toBe('entity-7')
  })

  it('falls back to payload recordId when id and entityId are missing', async () => {
    await handler({ recordId: 'record-9' }, makeCtx('customers.person.updated'))
    expect(executeRulesMock.mock.calls[0][1].entityId).toBe('record-9')
  })

  it('prefers payload id over entityId and recordId', async () => {
    await handler({ id: 'id-1', entityId: 'entity-1', recordId: 'record-1' }, makeCtx('customers.person.updated'))
    expect(executeRulesMock.mock.calls[0][1].entityId).toBe('id-1')
  })

  it('skips blank or non-scalar id candidates and uses the next usable key', async () => {
    await handler({ id: '   ', entityId: { nested: true }, recordId: ' record-2 ' }, makeCtx('customers.person.updated'))
    expect(executeRulesMock.mock.calls[0][1].entityId).toBe('record-2')
  })

  it('stringifies finite numeric ids', async () => {
    await handler({ id: 42 }, makeCtx('sales.order.created'))
    expect(executeRulesMock.mock.calls[0][1].entityId).toBe('42')
  })

  it('ignores ids longer than the log column allows', async () => {
    await handler({ id: 'x'.repeat(256) }, makeCtx('sales.order.created'))
    const context = executeRulesMock.mock.calls[0][1]
    expect(context).not.toHaveProperty('entityId')
  })

  it('omits entityId when the payload carries no id so the engine keeps the unknown fallback', async () => {
    await handler({ status: 'ACTIVE' }, makeCtx('sales.order.created'))
    const context = executeRulesMock.mock.calls[0][1]
    expect(context).not.toHaveProperty('entityId')
    expect(context.data).toEqual({ status: 'ACTIVE' })
  })

  it('omits entityId for non-object payloads', async () => {
    await handler(null, makeCtx('sales.order.created'))
    const context = executeRulesMock.mock.calls[0][1]
    expect(context).not.toHaveProperty('entityId')
    expect(context.data).toEqual({})
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
    }), { cache: null })
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

  it('reports a failed rule run to telemetry with a stable code', async () => {
    const failure = new Error('DB down')
    executeRulesMock.mockRejectedValueOnce(failure)

    await handler({ id: 'order-1' }, makeCtx('sales.order.created'))

    expect(mockReportError).toHaveBeenCalledTimes(1)
    expect(mockReportError).toHaveBeenCalledWith(failure, {
      module: 'business_rules',
      code: 'business_rules.crud_trigger_failed',
      attributes: { eventName: 'sales.order.created' },
    })
  })

  it('does not report to telemetry when the rule run succeeds', async () => {
    await handler({ id: 'order-1' }, makeCtx('sales.order.created'))
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('rejects ids containing control characters and uses the next usable key', async () => {
    await handler({ id: 'person-1\u0000injected', entityId: 'entity-3' }, makeCtx('customers.person.updated'))
    expect(executeRulesMock.mock.calls[0][1].entityId).toBe('entity-3')
  })

  it.each([
    ['a null byte', 'person\u0000-1'],
    ['a newline', 'person\n-1'],
    ['a carriage return', 'person\r-1'],
    ['an escape character', 'person\u001b[31m-1'],
    ['a delete character', 'person\u007f-1'],
  ])('omits an id containing %s', async (_label, id) => {
    await handler({ id }, makeCtx('customers.person.updated'))
    const context = executeRulesMock.mock.calls[0][1]
    expect(context).not.toHaveProperty('entityId')
  })

  it('reports a causation degradation when a rule ran without a usable entity id', async () => {
    executeRulesMock.mockResolvedValueOnce({
      allowed: true,
      executedRules: [{ rule: { id: 'rule-1' } } as never],
      totalExecutionTime: 1,
    })
    await handler({ id: 'bad\u0007id' }, makeCtx('customers.person.updated'))
    expect(mockReportCausationDegradation).toHaveBeenCalledWith('rule_entity_id_unresolved', {
      eventName: 'customers.person.updated',
    })
  })

  it('does not report a causation degradation when no rule ran for an unidentifiable entity', async () => {
    await handler({ id: 'bad\u0007id' }, makeCtx('customers.person.updated'))
    expect(mockReportCausationDegradation).not.toHaveBeenCalled()
  })

  it('does not report a causation degradation when the entity id resolves', async () => {
    await handler({ id: 'person-1' }, makeCtx('customers.person.updated'))
    expect(mockReportCausationDegradation).not.toHaveBeenCalled()
  })

  it('does not report a causation degradation for events that never reach the engine', async () => {
    await handler({}, makeCtx('query_index.updated'))
    await handler({}, makeCtx('customers.person.created', { tenantId: 't1' }))
    expect(mockReportCausationDegradation).not.toHaveBeenCalled()
  })
})
