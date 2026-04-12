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
  beforeEach(() => {
    processEventTriggersMock.mockClear()
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
})
