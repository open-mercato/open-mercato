import { PushNotificationDelivery } from '../../data/entities'
import { checkPushReceipts } from '../push-receipt-reaper'

// push-receipt-reaper → push-delivery → ./queue (bare `@open-mercato/queue`) + ../events. Neither is
// exercised here; stub them so the module graph loads without the queue/event bus (mirrors push-reaper.test).
jest.mock('../queue', () => ({
  enqueuePushDelivery: jest.fn(async () => 'job-id'),
  PUSH_DELIVERIES_QUEUE: 'push-deliveries',
  PUSH_STUCK_RECLAIM_QUEUE: 'push-stuck-reclaim',
}))

jest.mock('../../events', () => ({
  emitPushNotificationsEvent: jest.fn(async () => undefined),
}))

const TENANT = '00000000-0000-0000-0000-000000000001'
const NOW = new Date('2026-07-01T12:00:00.000Z')
// Default receipt window is [now-60m, now-15m]. This is old enough to have a receipt, still in window.
const IN_WINDOW = new Date(NOW.getTime() - 20 * 60 * 1000)
const TOO_FRESH = new Date(NOW.getTime() - 5 * 60 * 1000)

function makeRow(overrides: Partial<PushNotificationDelivery> = {}): PushNotificationDelivery {
  return {
    id: `del-${Math.random()}`,
    tenantId: TENANT,
    organizationId: 'org-1',
    userId: 'user-1',
    userDeviceId: 'device-1',
    provider: 'expo',
    status: 'sent',
    attempts: 1,
    lastError: null,
    sentAt: IN_WINDOW,
    providerResponse: { externalMessageId: 'ticket-1' },
    ...overrides,
  } as PushNotificationDelivery
}

// EM stub: `find` applies the status + sentAt-window filter; `findOne` returns the configured channel;
// `flush` is a no-op (rows are mutated in place).
function makeEm(rows: PushNotificationDelivery[], channel: Record<string, unknown> | null) {
  return {
    find: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
      const window = where.sentAt as { $gte: Date; $lte: Date }
      return rows.filter(
        (r) =>
          r.status === where.status &&
          r.sentAt instanceof Date &&
          r.sentAt >= window.$gte &&
          r.sentAt <= window.$lte,
      )
    }),
    findOne: jest.fn(async () => channel),
    flush: jest.fn(async () => undefined),
  }
}

type ReceiptOutcome = { ticketId: string; unregistered: boolean }

function makeResolve(options: {
  channelAdapterRegistry?: unknown
  checkReceipts?: (ids: string[], creds: unknown) => Promise<ReceiptOutcome[]>
  commandBus?: { execute: jest.Mock }
  credentialsService?: unknown
}) {
  const adapter = options.checkReceipts ? { checkReceipts: options.checkReceipts } : undefined
  const registry =
    options.channelAdapterRegistry ?? (adapter ? { get: () => adapter } : { get: () => undefined })
  const commandBus = options.commandBus ?? { execute: jest.fn(async () => undefined) }
  return {
    resolve: (name: string) => {
      switch (name) {
        case 'channelAdapterRegistry':
          return registry
        case 'commandBus':
          return commandBus
        case 'CommunicationChannel':
          return 'CommunicationChannel'
        case 'integrationCredentialsService':
          return options.credentialsService
        default:
          return undefined
      }
    },
    commandBus,
  }
}

describe('checkPushReceipts', () => {
  it('soft-deletes the device on a DeviceNotRegistered receipt via devices.deactivate and marks the row', async () => {
    const row = makeRow({ id: 'dead-1', userDeviceId: 'dev-dead' })
    const em = makeEm([row], { providerKey: 'expo', organizationId: 'org-1', userId: null, credentialsRef: null })
    const { resolve, commandBus } = makeResolve({
      checkReceipts: async () => [{ ticketId: 'ticket-1', unregistered: true }],
    })

    const result = await checkPushReceipts(em as never, { tenantId: TENANT }, resolve as never, NOW)

    expect(result).toEqual({ checked: 1, unregistered: 1 })
    expect(commandBus.execute).toHaveBeenCalledWith(
      'devices.user_devices.deactivate',
      expect.objectContaining({
        input: { id: 'dev-dead', tenantId: TENANT, userId: 'user-1', organizationId: 'org-1' },
      }),
    )
    expect((row.providerResponse as Record<string, unknown>).receiptChecked).toBe(true)
    expect((row.providerResponse as Record<string, unknown>).unregistered).toBe(true)
    expect(row.lastError).toBe('device_unregistered')
  })

  it('keeps the device on a transient receipt (MessageRateExceeded) but marks the row checked', async () => {
    const row = makeRow({ id: 'rate-1' })
    const em = makeEm([row], { providerKey: 'expo', organizationId: 'org-1', userId: null, credentialsRef: null })
    const { resolve, commandBus } = makeResolve({
      checkReceipts: async () => [{ ticketId: 'ticket-1', unregistered: false }],
    })

    const result = await checkPushReceipts(em as never, { tenantId: TENANT }, resolve as never, NOW)

    expect(result).toEqual({ checked: 1, unregistered: 0 })
    expect(commandBus.execute).not.toHaveBeenCalled()
    expect((row.providerResponse as Record<string, unknown>).receiptChecked).toBe(true)
    expect((row.providerResponse as Record<string, unknown>).unregistered).toBeUndefined()
  })

  it('skips rows already receipt-checked on a prior sweep (no duplicate poll)', async () => {
    const row = makeRow({ id: 'done-1', providerResponse: { externalMessageId: 'ticket-1', receiptChecked: true } })
    const em = makeEm([row], { providerKey: 'expo', organizationId: 'org-1', userId: null, credentialsRef: null })
    const checkReceipts = jest.fn(async () => [] as ReceiptOutcome[])
    const { resolve } = makeResolve({ checkReceipts })

    const result = await checkPushReceipts(em as never, { tenantId: TENANT }, resolve as never, NOW)

    expect(result).toEqual({ checked: 0, unregistered: 0 })
    expect(checkReceipts).not.toHaveBeenCalled()
  })

  it('ignores rows too fresh to have a receipt yet', async () => {
    const row = makeRow({ id: 'fresh-1', sentAt: TOO_FRESH })
    const em = makeEm([row], { providerKey: 'expo', organizationId: 'org-1', userId: null, credentialsRef: null })
    const checkReceipts = jest.fn(async () => [] as ReceiptOutcome[])
    const { resolve } = makeResolve({ checkReceipts })

    const result = await checkPushReceipts(em as never, { tenantId: TENANT }, resolve as never, NOW)

    expect(result).toEqual({ checked: 0, unregistered: 0 })
    expect(checkReceipts).not.toHaveBeenCalled()
  })

  it('never calls a provider whose adapter does not support receipt checking (fcm/apns)', async () => {
    const row = makeRow({ id: 'fcm-1', provider: 'fcm' })
    const em = makeEm([row], { providerKey: 'fcm', organizationId: 'org-1', userId: null, credentialsRef: null })
    // Registry returns a plain send-only adapter (no checkReceipts).
    const { resolve } = makeResolve({ channelAdapterRegistry: { get: () => ({ sendMessage: jest.fn() }) } })

    const result = await checkPushReceipts(em as never, { tenantId: TENANT }, resolve as never, NOW)

    expect(result).toEqual({ checked: 0, unregistered: 0 })
    expect(em.findOne).not.toHaveBeenCalled()
  })
})
