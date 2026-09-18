import { PushNotificationDelivery } from '../../data/entities'
import { enqueuePushDelivery } from '../queue'
import { emitPushNotificationsEvent } from '../../events'
import { processPushDeliveryJob } from '../push-delivery'

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

type SendResult = {
  externalMessageId: string
  status: 'sent' | 'queued' | 'failed'
  error?: string
  metadata?: Record<string, unknown>
}

function makeDelivery(overrides: Partial<PushNotificationDelivery> = {}): PushNotificationDelivery {
  return {
    id: 'del-1',
    tenantId: TENANT,
    organizationId: null,
    notificationId: 'notif-1',
    notificationTypeId: 'orders.shipped',
    userDeviceId: 'dev-1',
    userId: 'user-1',
    provider: 'push_stub',
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

function makeDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dev-1',
    tenantId: TENANT,
    userId: 'user-1',
    organizationId: null,
    pushToken: 'tok-123456789',
    platform: 'ios',
    deletedAt: null,
    ...overrides,
  }
}

function makeHarness(opts: {
  delivery: PushNotificationDelivery | null
  device?: ReturnType<typeof makeDevice> | null
  channel?: Record<string, unknown> | null
  sendResult?: SendResult
  adapterPresent?: boolean
}) {
  const channel = opts.channel === undefined
    ? { providerKey: 'push_stub', credentialsRef: 'cred-1', userId: null }
    : opts.channel
  const device = opts.device === undefined ? makeDevice() : opts.device

  const sendMessage = jest.fn(async (): Promise<SendResult> => opts.sendResult ?? { externalMessageId: 'm1', status: 'sent', metadata: { stub: true } })
  const convertOutbound = jest.fn(async ({ body }: { body: string }) => ({ content: { text: body, bodyFormat: 'text' as const } }))
  const adapter = { providerKey: 'push_stub', channelType: 'push', sendMessage, convertOutbound }
  const registry = { get: jest.fn(() => (opts.adapterPresent === false ? undefined : adapter)) }
  const credentialsService = { resolve: jest.fn(async () => ({})) }
  const commandBus = { execute: jest.fn(async () => ({})) }

  const em = {
    // Simulate the atomic claim + every fenced write-back: report 1 row (and mutate) only when BOTH the
    // status guard AND the `attempts` lease-token guard match. The claim increments `attempts` via a
    // `raw('"attempts" + 1')` fragment (any non-undefined `data.attempts` here is that fragment), which
    // this mock models as +1; fenced write-backs carry no `attempts` in their data.
    nativeUpdate: jest.fn(async (entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      if (entity !== PushNotificationDelivery || !opts.delivery) return 0
      const statusMatches = where.status === undefined || opts.delivery.status === where.status
      const attemptsMatches = where.attempts === undefined || opts.delivery.attempts === where.attempts
      if (!statusMatches || !attemptsMatches) return 0
      const { attempts, ...rest } = data
      if (attempts !== undefined) opts.delivery.attempts = (opts.delivery.attempts ?? 0) + 1
      Object.assign(opts.delivery, rest)
      return 1
    }),
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === PushNotificationDelivery) return opts.delivery
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
      channelAdapterRegistry: registry,
      integrationCredentialsService: credentialsService,
      commandBus,
    }
    return map[name] as T
  })

  return { em, resolve, sendMessage, registry, commandBus, credentialsService }
}

const job = { deliveryId: 'del-1', tenantId: TENANT, organizationId: null }

beforeEach(() => {
  enqueueMock.mockClear()
  emitMock.mockClear()
})

describe('processPushDeliveryJob', () => {
  it('marks delivery sent and records the provider response', async () => {
    const delivery = makeDelivery()
    const h = makeHarness({ delivery })

    const result = await processPushDeliveryJob(h.em as never, job, h.resolve)

    expect(result?.status).toBe('sent')
    expect(delivery.status).toBe('sent')
    expect(delivery.sentAt).toBeTruthy()
    expect(delivery.attempts).toBe(1)
    expect(h.sendMessage).toHaveBeenCalledTimes(1)
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(emitMock).toHaveBeenCalledWith('push_notifications.delivery.sent', expect.any(Object), expect.any(Object))
  })

  it('increments and persists attempts in the atomic claim, before the provider send', async () => {
    // MAX_ATTEMPTS must cap real provider sends across crashes: the attempt is counted and persisted
    // in the atomic claim itself (a single `nativeUpdate`), BEFORE sendMessage — so a crash after the
    // send cannot lose the increment and let the reaper re-drive the row past MAX_ATTEMPTS.
    const delivery = makeDelivery({ attempts: 0 })
    const h = makeHarness({ delivery })
    let attemptsAtSend: number | undefined
    let nativeUpdatesBeforeSend = 0
    h.sendMessage.mockImplementationOnce(async () => {
      attemptsAtSend = delivery.attempts
      nativeUpdatesBeforeSend = (h.em.nativeUpdate as jest.Mock).mock.calls.length
      return { externalMessageId: 'm1', status: 'sent', metadata: { stub: true } }
    })

    await processPushDeliveryJob(h.em as never, job, h.resolve)

    // The increment was already visible AND already persisted (via the claim update) when the adapter
    // was invoked — the flow no longer relies on a separate `em.flush()`.
    expect(attemptsAtSend).toBe(1)
    expect(nativeUpdatesBeforeSend).toBeGreaterThanOrEqual(1)
  })

  it('packs data, options and the silent flag into the send envelope', async () => {
    const delivery = makeDelivery({
      payload: {
        title: 'Hi',
        body: 'There',
        data: { orderId: 'o-1' },
        options: { sound: 'chime.caf', badge: 2 },
        silent: true,
      },
    })
    const h = makeHarness({ delivery })

    await processPushDeliveryJob(h.em as never, job, h.resolve)

    const raw = (h.sendMessage.mock.calls[0][0] as { content: { raw: Record<string, unknown> } }).content.raw
    expect(raw).toMatchObject({
      title: 'Hi',
      body: 'There',
      data: { orderId: 'o-1' },
      options: { sound: 'chime.caf', badge: 2 },
      silent: true,
    })
  })

  it('is idempotent: a non-pending delivery is a no-op', async () => {
    const delivery = makeDelivery({ status: 'sent' })
    const h = makeHarness({ delivery })

    await processPushDeliveryJob(h.em as never, job, h.resolve)

    expect(h.sendMessage).not.toHaveBeenCalled()
  })

  it('skips when the device is gone or has no token', async () => {
    const delivery = makeDelivery()
    const h = makeHarness({ delivery, device: null })

    await processPushDeliveryJob(h.em as never, job, h.resolve)

    expect(delivery.status).toBe('skipped')
    expect(delivery.lastError).toBe('device_unavailable')
    expect(h.sendMessage).not.toHaveBeenCalled()
  })

  it('fails terminally with no_adapter when the provider package is absent', async () => {
    const delivery = makeDelivery()
    const h = makeHarness({ delivery, adapterPresent: false })

    await processPushDeliveryJob(h.em as never, job, h.resolve)

    expect(delivery.status).toBe('failed')
    expect(delivery.lastError).toBe('no_adapter')
  })

  it('soft-deletes the device through the devices command on unregistered', async () => {
    const delivery = makeDelivery()
    const h = makeHarness({
      delivery,
      sendResult: { externalMessageId: '', status: 'failed', error: 'device_unregistered', metadata: { unregistered: true } },
    })

    await processPushDeliveryJob(h.em as never, job, h.resolve)

    expect(delivery.status).toBe('failed')
    expect(delivery.lastError).toBe('device_unregistered')
    expect(h.commandBus.execute).toHaveBeenCalledWith(
      'devices.user_devices.deactivate',
      expect.objectContaining({ input: expect.objectContaining({ id: 'dev-1', tenantId: TENANT }) }),
    )
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('fails terminally with channel_unavailable when the provider channel is missing', async () => {
    const delivery = makeDelivery()
    const h = makeHarness({ delivery, channel: null })

    await processPushDeliveryJob(h.em as never, job, h.resolve)

    expect(delivery.status).toBe('failed')
    expect(delivery.lastError).toBe('channel_unavailable')
    expect(h.sendMessage).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('treats an adapter exception as a retryable failure', async () => {
    const delivery = makeDelivery({ attempts: 0 })
    const h = makeHarness({ delivery })
    h.sendMessage.mockRejectedValueOnce(new Error('socket hang up'))

    await processPushDeliveryJob(h.em as never, job, h.resolve)

    expect(delivery.status).toBe('pending')
    expect(delivery.attempts).toBe(1)
    expect(delivery.lastError).toBe('socket hang up')
    expect(enqueueMock).toHaveBeenCalledTimes(1)
  })

  it('retries a transient failure with backoff, then expires after max attempts', async () => {
    const retry = makeDelivery({ attempts: 0 })
    const h1 = makeHarness({ delivery: retry, sendResult: { externalMessageId: '', status: 'failed', error: 'boom' } })
    await processPushDeliveryJob(h1.em as never, job, h1.resolve)
    expect(retry.status).toBe('pending')
    expect(retry.attempts).toBe(1)
    expect(retry.nextRetryAt).toBeInstanceOf(Date)
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    // The row is reset to `pending` to release the claim, but the failed event reports the logical
    // outcome of the attempt (`retrying`), not the reset row status, so subscribers keying off
    // `status` aren't misled.
    expect(emitMock).toHaveBeenCalledWith(
      'push_notifications.delivery.failed',
      expect.objectContaining({ status: 'retrying', willRetry: true }),
      expect.any(Object),
    )

    const exhausted = makeDelivery({ attempts: 2 })
    const h2 = makeHarness({ delivery: exhausted, sendResult: { externalMessageId: '', status: 'failed', error: 'boom' } })
    await processPushDeliveryJob(h2.em as never, job, h2.resolve)
    expect(exhausted.status).toBe('expired')
    expect(exhausted.attempts).toBe(3)
    expect(exhausted.lastError).toBe('boom')
    expect(exhausted.nextRetryAt).toBeNull()
  })

  it('abandons a delivery whose lease was stolen mid-send (fenced write-back is a no-op)', async () => {
    // Worker A claims (attempts 0 -> 1, lease token = 1). While A's send is in flight the reaper resets
    // the row and worker B re-claims it (attempts -> 2). A then returns a retryable failure: its fenced
    // write-back must MISS (attempts moved past A's lease), so A neither re-enqueues a duplicate job nor
    // rewinds B's attempt counter. This is the B3 regression guard.
    const delivery = makeDelivery({ attempts: 0 })
    const h = makeHarness({ delivery, sendResult: { externalMessageId: '', status: 'failed', error: 'boom' } })
    h.sendMessage.mockImplementationOnce(async () => {
      // Simulate reaper reset + worker B re-claim: attempts advances beyond A's lease, status stays sending.
      delivery.attempts = 2
      return { externalMessageId: '', status: 'failed', error: 'boom' }
    })

    await processPushDeliveryJob(h.em as never, job, h.resolve)

    expect(enqueueMock).not.toHaveBeenCalled()
    expect(delivery.attempts).toBe(2)
    expect(delivery.status).toBe('sending')
    expect(delivery.lastError).toBeNull()
  })

  it('times out a hung provider send and treats it as a retryable failure', async () => {
    // A send that outlives OM_PUSH_SEND_TIMEOUT_MS must not block the worker (which would let the reaper
    // steal the lease). It is surfaced as a retryable `send_timeout` and the row is released to pending.
    const prev = process.env.OM_PUSH_SEND_TIMEOUT_MS
    process.env.OM_PUSH_SEND_TIMEOUT_MS = '5000'
    try {
      const delivery = makeDelivery({ attempts: 0 })
      const h = makeHarness({ delivery })
      // Never resolves — the timeout must win.
      h.sendMessage.mockImplementationOnce(() => new Promise<never>(() => {}))

      await processPushDeliveryJob(h.em as never, job, h.resolve)

      expect(delivery.status).toBe('pending')
      expect(delivery.lastError).toBe('send_timeout')
      expect(enqueueMock).toHaveBeenCalledTimes(1)
    } finally {
      if (prev === undefined) delete process.env.OM_PUSH_SEND_TIMEOUT_MS
      else process.env.OM_PUSH_SEND_TIMEOUT_MS = prev
    }
  })

  it('resolves credentials by the channel org context, not the notification org', async () => {
    // A tenant-level (org-less) push channel serving an org-scoped notification: credentials were
    // stored under the channel's org context (tenantId when the channel is org-less), so resolution
    // must use `channel.organizationId ?? tenantId`, NOT the notification's org.
    const delivery = makeDelivery({ organizationId: 'org-1' })
    const h = makeHarness({
      delivery,
      channel: { providerKey: 'push_stub', credentialsRef: 'cred-1', userId: null, organizationId: null },
    })
    const orgJob = { deliveryId: 'del-1', tenantId: TENANT, organizationId: 'org-1' }

    await processPushDeliveryJob(h.em as never, orgJob, h.resolve)

    expect(h.credentialsService.resolve).toHaveBeenCalledWith(
      'channel_push_stub',
      expect.objectContaining({ tenantId: TENANT, organizationId: TENANT }),
    )
  })

  it('resolves credentials under the channel organization when the channel is org-bound', async () => {
    const delivery = makeDelivery({ organizationId: 'org-1' })
    const h = makeHarness({
      delivery,
      channel: { providerKey: 'push_stub', credentialsRef: 'cred-1', userId: null, organizationId: 'org-2' },
    })
    const orgJob = { deliveryId: 'del-1', tenantId: TENANT, organizationId: 'org-1' }

    await processPushDeliveryJob(h.em as never, orgJob, h.resolve)

    expect(h.credentialsService.resolve).toHaveBeenCalledWith(
      'channel_push_stub',
      expect.objectContaining({ organizationId: 'org-2' }),
    )
  })

  it('does not re-send a row it cannot claim (lost the race / already terminal)', async () => {
    const delivery = makeDelivery({ status: 'sending' })
    const h = makeHarness({ delivery })

    const result = await processPushDeliveryJob(h.em as never, job, h.resolve)

    expect(result?.status).toBe('sending')
    expect(h.sendMessage).not.toHaveBeenCalled()
  })
})
