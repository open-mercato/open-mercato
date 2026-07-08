jest.mock('../../lib/event-trigger-service', () => ({
  processEventTriggers: jest.fn().mockResolvedValue({
    triggered: 0,
    skipped: 0,
    errors: [],
    instances: [],
  }),
}))

import handle from '../event-trigger'
import { processEventTriggers } from '../../lib/event-trigger-service'

const processEventTriggersMock = jest.mocked(processEventTriggers)

describe('workflow event-trigger subscriber', () => {
  const originalDebug = process.env.OM_WORKFLOW_TRIGGER_DEBUG

  beforeEach(() => {
    processEventTriggersMock.mockClear()
  })

  afterEach(() => {
    if (originalDebug === undefined) delete process.env.OM_WORKFLOW_TRIGGER_DEBUG
    else process.env.OM_WORKFLOW_TRIGGER_DEBUG = originalDebug
    jest.restoreAllMocks()
  })

  it('warns and skips when subscriber context is missing eventName', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await handle(
      { id: 'order-1' },
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        resolve: jest.fn(),
      }
    )

    expect(warnSpy).toHaveBeenCalledWith(
      '[workflow-trigger] Skipping trigger evaluation because subscriber context is missing eventName'
    )
    expect(processEventTriggersMock).not.toHaveBeenCalled()
  })

  it('uses trusted scope from subscriber context instead of payload scope', async () => {
    await handle(
      {
        tenantId: 'attacker-tenant',
        organizationId: 'attacker-org',
        orderId: 'order-1',
      },
      {
        eventName: 'sales.order.created',
        tenantId: 'victim-tenant',
        organizationId: 'victim-org',
        resolve: jest.fn((name: string) => {
          if (name === 'em') return {}
          throw new Error(`Unexpected dependency: ${name}`)
        }),
      }
    )

    expect(processEventTriggersMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        resolve: expect.any(Function),
      }),
      expect.objectContaining({
        eventName: 'sales.order.created',
        tenantId: 'victim-tenant',
        organizationId: 'victim-org',
        payload: expect.objectContaining({
          tenantId: 'attacker-tenant',
          organizationId: 'attacker-org',
        }),
      })
    )
  })

  it('skips events without trusted scope even if payload contains tenant data', async () => {
    await handle(
      {
        tenantId: 'payload-tenant',
        organizationId: 'payload-org',
      },
      {
        eventName: 'sales.order.created',
        resolve: jest.fn(),
      }
    )

    expect(processEventTriggersMock).not.toHaveBeenCalled()
  })

  it('logs opt-in trigger evaluation diagnostics', async () => {
    process.env.OM_WORKFLOW_TRIGGER_DEBUG = 'true'
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    await handle(
      { orderId: 'order-1' },
      {
        eventName: 'sales.order.created',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        resolve: jest.fn((name: string) => {
          if (name === 'em') return {}
          throw new Error(`Unexpected dependency: ${name}`)
        }),
      }
    )

    expect(logSpy).toHaveBeenCalledWith(
      '[workflow-trigger] Evaluated triggers for "sales.order.created": ' +
      'tenant=tenant-1 organization=org-1 matched=0 triggered=0 skipped=0 errors=0'
    )
  })
})
