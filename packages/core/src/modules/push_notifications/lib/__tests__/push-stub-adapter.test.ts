import { getChannelAdapterRegistry } from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { PushNotificationDelivery } from '../../data/entities'
import { enqueuePushDelivery } from '../queue'
import { emitPushNotificationsEvent } from '../../events'
import { processPushDeliveryJob } from '../push-delivery'
import {
  PUSH_STUB_ENV,
  PUSH_STUB_PROVIDER_KEY,
  ensurePushStubAdapterRegistered,
} from '../push-stub-adapter'

// Exercise the REAL push_stub adapter through the REAL worker pipeline (the sibling
// push-delivery.test.ts mocks the adapter). This is the only coverage that proves the stub
// adapter, the channelAdapterRegistry resolution, and the unregistered→commandBus soft-delete
// path are wired correctly end-to-end.
jest.mock('../queue', () => ({
  enqueuePushDelivery: jest.fn(async () => 'job-id'),
  PUSH_DELIVERIES_QUEUE: 'push-deliveries',
}))

jest.mock('../../events', () => ({
  emitPushNotificationsEvent: jest.fn(async () => undefined),
}))

const enqueueMock = enqueuePushDelivery as jest.MockedFunction<typeof enqueuePushDelivery>
const emitMock = emitPushNotificationsEvent as jest.MockedFunction<typeof emitPushNotificationsEvent>

const TENANT = '00000000-0000-0000-0000-000000000001'
const deviceRef = { __entity: 'UserDevice' }
const channelRef = { __entity: 'CommunicationChannel' }

function makeDelivery(overrides: Partial<PushNotificationDelivery> = {}): PushNotificationDelivery {
  return {
    id: 'del-1',
    tenantId: TENANT,
    organizationId: null,
    notificationId: 'notif-1',
    notificationTypeId: 'orders.shipped',
    userDeviceId: 'dev-1',
    userId: 'user-1',
    provider: PUSH_STUB_PROVIDER_KEY,
    tokenSnapshot: '23456789',
    status: 'pending',
    attempts: 0,
    lastError: null,
    payload: { title: 'Hi', body: 'There', data: {} },
    providerResponse: null,
    createdAt: new Date(),
    sentAt: null,
    nextRetryAt: null,
    updatedAt: new Date(),
    ...overrides,
  } as PushNotificationDelivery
}

function makeHarness(delivery: PushNotificationDelivery, pushToken: string) {
  const device = { id: 'dev-1', tenantId: TENANT, userId: 'user-1', organizationId: null, pushToken, platform: 'ios', deletedAt: null }
  const channel = { providerKey: PUSH_STUB_PROVIDER_KEY, credentialsRef: null, userId: null }
  const commandBus = { execute: jest.fn(async () => ({})) }
  const em = {
    nativeUpdate: jest.fn(async (entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      if (entity !== PushNotificationDelivery) return 0
      const statusMatches = where.status === undefined || delivery.status === where.status
      if (!statusMatches) return 0
      Object.assign(delivery, data)
      return 1
    }),
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === PushNotificationDelivery) return delivery
      if (entity === deviceRef) return device
      if (entity === channelRef) return channel
      return null
    }),
    flush: jest.fn(async () => undefined),
  }
  const resolve = (<T,>(name: string): T => {
    const map: Record<string, unknown> = {
      UserDevice: deviceRef,
      CommunicationChannel: channelRef,
      channelAdapterRegistry: getChannelAdapterRegistry(),
      commandBus,
    }
    return map[name] as T
  })
  return { em, resolve, commandBus }
}

const job = { deliveryId: 'del-1', tenantId: TENANT, organizationId: null }
let previousEnv: string | undefined

beforeAll(() => {
  previousEnv = process.env[PUSH_STUB_ENV]
  process.env[PUSH_STUB_ENV] = '1'
  ensurePushStubAdapterRegistered()
})

afterAll(() => {
  if (previousEnv === undefined) delete process.env[PUSH_STUB_ENV]
  else process.env[PUSH_STUB_ENV] = previousEnv
})

beforeEach(() => {
  enqueueMock.mockClear()
  emitMock.mockClear()
})

describe('push_stub adapter end-to-end through processPushDeliveryJob', () => {
  it('registers under the stub provider key when the env flag is set', () => {
    expect(getChannelAdapterRegistry().get(PUSH_STUB_PROVIDER_KEY)).toBeDefined()
  })

  it('marks the delivery sent for a normal token', async () => {
    const delivery = makeDelivery()
    const h = makeHarness(delivery, 'expo-token-normal-abcd1234')

    const result = await processPushDeliveryJob(h.em as never, job, h.resolve)

    expect(result?.status).toBe('sent')
    expect(delivery.status).toBe('sent')
    expect(delivery.sentAt).toBeTruthy()
    expect(h.commandBus.execute).not.toHaveBeenCalled()
    expect(emitMock).toHaveBeenCalledWith('push_notifications.delivery.sent', expect.any(Object), expect.any(Object))
  })

  it('retries a forced-failure token (stays pending, re-enqueues)', async () => {
    const delivery = makeDelivery()
    const h = makeHarness(delivery, 'expo-token-fail-zzzz')

    await processPushDeliveryJob(h.em as never, job, h.resolve)

    expect(delivery.status).toBe('pending')
    expect(delivery.attempts).toBe(1)
    expect(delivery.lastError).toBe('push_stub_forced_failure')
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(h.commandBus.execute).not.toHaveBeenCalled()
  })

  it('soft-deletes the device via the devices command for an unregistered token', async () => {
    const delivery = makeDelivery()
    const h = makeHarness(delivery, 'expo-token-unregistered-9999')

    await processPushDeliveryJob(h.em as never, job, h.resolve)

    expect(delivery.status).toBe('failed')
    expect(delivery.lastError).toBe('device_unregistered')
    expect(h.commandBus.execute).toHaveBeenCalledWith(
      'devices.user_devices.deactivate',
      expect.objectContaining({
        input: expect.objectContaining({ id: 'dev-1', tenantId: TENANT, userId: 'user-1' }),
        ctx: expect.objectContaining({ systemActor: true, auth: null }),
      }),
    )
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})
