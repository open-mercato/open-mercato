jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

jest.mock('../../lib/event-trigger-service', () => ({
  processEventTriggers: jest.fn().mockResolvedValue({
    triggered: 0,
    skipped: 0,
    errors: [],
    instances: [],
  }),
}))

import { createLogger } from '@open-mercato/shared/lib/logger'
import handle from '../event-trigger'
import { processEventTriggers } from '../../lib/event-trigger-service'

const processEventTriggersMock = jest.mocked(processEventTriggers)
const subscriberLogger = createLogger('workflows')
const warnMock = subscriberLogger.warn as jest.Mock
const debugMock = subscriberLogger.debug as jest.Mock

describe('workflow event-trigger subscriber', () => {
  beforeEach(() => {
    processEventTriggersMock.mockClear()
    warnMock.mockClear()
    debugMock.mockClear()
  })

  it('warns and skips when subscriber context is missing eventName', async () => {
    await handle(
      { id: 'order-1' },
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        resolve: jest.fn(),
      }
    )

    expect(warnMock).toHaveBeenCalledWith(
      'Skipping trigger evaluation because subscriber context is missing eventName'
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

  it('emits trigger evaluation diagnostics at debug level', async () => {
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

    expect(debugMock).toHaveBeenCalledWith('Evaluated triggers', {
      event: 'sales.order.created',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      matched: 0,
      triggered: 0,
      skipped: 0,
      errors: 0,
    })
  })
})
