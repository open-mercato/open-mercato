/** @jest-environment node */

/**
 * #7174 review (major): the fail-closed consumer must be exercised through a real
 * producer, not only by calling the handler with hand-built trusted context.
 * `emitOrderLifecycleEventsForTransition` (sales/commands/documents.ts) is the shipped
 * producer behind `sales.order.confirmed`/`sales.order.cancelled`; when it emitted the
 * scope only in the payload, the event bus handed this subscriber `tenantId: null` and
 * every subscribed webhook silently stopped firing.
 */

import type { EntityManager } from '@mikro-orm/postgresql'

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

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../../lib/delivery', () => ({
  createWebhookDelivery: jest.fn(),
}))
jest.mock('../../lib/queue', () => ({
  enqueueWebhookDelivery: jest.fn(),
}))
jest.mock('../../lib/integration-state', () => ({
  isWebhookIntegrationEnabled: jest.fn(),
}))

import handler from '../outbound-dispatch'
import { emitOrderLifecycleEventsForTransition } from '@open-mercato/core/modules/sales/commands/documents'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createWebhookDelivery } from '../../lib/delivery'
import { enqueueWebhookDelivery } from '../../lib/queue'
import { isWebhookIntegrationEnabled } from '../../lib/integration-state'

const dispatchLoggerWarn = createLogger('webhooks').warn as jest.Mock

type EmitOptionsLike = { tenantId?: string | null; organizationId?: string | null }

/**
 * Mirrors the event bus contract this subscriber depends on
 * (packages/events/src/bus.ts `deliver`): the handler's `tenantId`/`organizationId` come
 * from the emit options and are null when the producer passes none.
 */
function installCapturingBus(rootEm: EntityManager) {
  const emit = jest.fn(
    async (
      event: string,
      payload: Record<string, unknown>,
      options?: EmitOptionsLike,
    ): Promise<void> => {
      await handler(payload, {
        eventName: event,
        tenantId: options?.tenantId ?? null,
        organizationId: options?.organizationId ?? null,
        resolve: <T,>(name: string): T => {
          if (name === 'em') return rootEm as T
          throw new Error(`Unexpected dependency: ${name}`)
        },
      })
    },
  )
  setGlobalEventBus({ emit } as never)
  return emit
}

function createDispatchEntityManagers() {
  const webhookEm = {
    flush: jest.fn(async () => undefined),
  } as unknown as EntityManager
  const handlerEm = {
    fork: jest.fn(() => webhookEm),
    flush: jest.fn(async () => undefined),
  } as unknown as EntityManager
  const rootEm = {
    fork: jest.fn(() => handlerEm),
    flush: jest.fn(async () => undefined),
  } as unknown as EntityManager
  return { rootEm, handlerEm, webhookEm }
}

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve))

describe('outbound dispatch through a real producer', () => {
  afterEach(() => {
    setGlobalEventBus({ emit: jest.fn() } as never)
    jest.clearAllMocks()
  })

  it('delivers webhooks for sales.order.confirmed emitted by the sales producer', async () => {
    const { rootEm, handlerEm, webhookEm } = createDispatchEntityManagers()
    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      {
        id: 'webhook-1',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        subscribedEvents: ['sales.order.confirmed'],
      },
    ])
    ;(isWebhookIntegrationEnabled as jest.Mock).mockResolvedValue(true)
    ;(createWebhookDelivery as jest.Mock).mockResolvedValue({
      id: 'delivery-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    ;(enqueueWebhookDelivery as jest.Mock).mockResolvedValue('job-1')

    const emit = installCapturingBus(rootEm)

    emitOrderLifecycleEventsForTransition({
      order: {
        id: 'order-1',
        orderNumber: 'SO-1',
        status: 'confirmed',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      } as never,
      previousStatus: 'draft',
    })
    await flushMicrotasks()

    expect(emit).toHaveBeenCalledWith(
      'sales.order.confirmed',
      expect.objectContaining({ orderId: 'order-1', tenantId: 'tenant-1' }),
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(findWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1' }),
      expect.anything(),
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(createWebhookDelivery).toHaveBeenCalledWith(expect.objectContaining({
      em: webhookEm,
      eventId: 'sales.order.confirmed',
    }))
    expect(handlerEm.fork).toHaveBeenCalled()
  })

  it('stays fail-closed when a producer supplies the scope only in the payload', async () => {
    const { rootEm } = createDispatchEntityManagers()
    const emit = installCapturingBus(rootEm)

    await emit(
      'sales.order.confirmed',
      {
        orderId: 'order-1',
        tenantId: 'attacker-tenant',
        organizationId: 'attacker-org',
      },
      undefined,
    )

    expect(findWithDecryption).not.toHaveBeenCalled()
    expect(createWebhookDelivery).not.toHaveBeenCalled()
    expect(dispatchLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('no trusted scope'),
      expect.objectContaining({ eventId: 'sales.order.confirmed' }),
    )
  })
})
