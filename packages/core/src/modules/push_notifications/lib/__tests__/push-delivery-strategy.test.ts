import { getNotificationType } from '@open-mercato/core/modules/notifications/lib/notification-type-registry'
import {
  registerModules,
  registerAppDictionaryLoader,
  invalidateDictionaryCache,
} from '@open-mercato/shared/lib/i18n/server'
import { enqueuePushDelivery } from '../queue'
import { mobilePushDeliveryStrategy } from '../push-delivery-strategy'

jest.mock('@open-mercato/core/modules/notifications/lib/notification-type-registry', () => ({
  getNotificationType: jest.fn(),
}))

jest.mock('../queue', () => ({
  enqueuePushDelivery: jest.fn(async () => 'job-id'),
  PUSH_DELIVERIES_QUEUE: 'push-deliveries',
}))

// The fan-out persists the payload as `sql`${JSON.stringify(payload)}::jsonb`` so the interpolated
// JSON stays a raw jsonb literal. Capture that JSON string here so payload-content assertions can
// decode it; everything else in kysely is preserved.
jest.mock('kysely', () => ({
  ...jest.requireActual('kysely'),
  sql: (_strings: TemplateStringsArray, ...values: unknown[]) => ({ __rawJson: values[0] }),
}))

function decodePayload(row: Record<string, unknown>): { title?: string; body?: string | null; data: Record<string, string>; options?: Record<string, unknown>; silent?: boolean } {
  return JSON.parse((row.payload as { __rawJson: string }).__rawJson)
}

const getTypeMock = getNotificationType as jest.MockedFunction<typeof getNotificationType>
const enqueueMock = enqueuePushDelivery as jest.MockedFunction<typeof enqueuePushDelivery>

const TENANT = '00000000-0000-0000-0000-000000000001'
const deviceRef = { __entity: 'UserDevice' }
const channelRef = { __entity: 'CommunicationChannel' }

// Minimal chainable stub for the `em.getKysely()` builder used by the fan-out insert.
// `insertResult` controls which rows the INSERT ... ON CONFLICT DO NOTHING reports as actually
// inserted (undefined ⇒ one row per input row, i.e. no conflict).
function makeKysely(insertResult?: Array<{ id: string }>) {
  const captured: {
    insertRows: Array<Record<string, unknown>> | null
    conflictColumns: string[] | null
    conflictWhere: unknown[] | null
    updates: Array<{ set: Record<string, unknown>; wheres: unknown[][] }>
  } = { insertRows: null, conflictColumns: null, conflictWhere: null, updates: [] }

  const insertBuilder: Record<string, unknown> = {
    values: (rows: Array<Record<string, unknown>>) => {
      captured.insertRows = rows
      return insertBuilder
    },
    onConflict: (cb: (oc: unknown) => unknown) => {
      const oc: Record<string, unknown> = {
        columns: (cols: string[]) => {
          captured.conflictColumns = cols
          return oc
        },
        where: (...args: unknown[]) => {
          captured.conflictWhere = args
          return oc
        },
        doNothing: () => oc,
      }
      cb(oc)
      return insertBuilder
    },
    returning: () => insertBuilder,
    execute: async () => insertResult ?? (captured.insertRows ?? []).map((_, i) => ({ id: `del-${i + 1}` })),
  }

  const db = {
    insertInto: () => insertBuilder,
    updateTable: () => {
      const record: { set: Record<string, unknown>; wheres: unknown[][] } = { set: {}, wheres: [] }
      const builder = {
        set: (set: Record<string, unknown>) => {
          record.set = set
          return builder
        },
        where: (...where: unknown[]) => {
          record.wheres.push(where)
          return builder
        },
        execute: async () => {
          captured.updates.push(record)
          return undefined
        },
      }
      return builder
    },
  }
  return { db, captured }
}

function makeCtx(opts: {
  channels?: Array<Record<string, unknown>>
  devices?: Array<Record<string, unknown>>
  insertResult?: Array<{ id: string }>
  notification?: Record<string, unknown>
}) {
  const { db, captured } = makeKysely(opts.insertResult)
  const em = {
    getKysely: jest.fn(() => db),
    // Channels and devices are both loaded via em.find; devices go through findWithDecryption, which
    // forwards to em.find (a no-op decrypt when encryption is disabled, as in this suite).
    find: jest.fn(async (entity: unknown) =>
      entity === channelRef ? (opts.channels ?? []) : entity === deviceRef ? (opts.devices ?? []) : [],
    ),
  }
  const resolve = (<T,>(name: string): T => {
    const map: Record<string, unknown> = { em, UserDevice: deviceRef, CommunicationChannel: channelRef }
    return map[name] as T
  })
  const notification = {
    id: 'notif-1',
    type: 'orders.shipped',
    recipientUserId: 'user-1',
    tenantId: TENANT,
    organizationId: null,
    linkHref: '/orders/1',
    ...(opts.notification ?? {}),
  }
  const ctx = { notification, title: 'Shipped', body: 'Your order shipped', resolve } as never
  return { ctx, em, captured }
}

beforeEach(() => {
  getTypeMock.mockReset()
  enqueueMock.mockClear()
  enqueueMock.mockResolvedValue('job-id')
  // Default: known type. Per-channel opt-out is enforced upstream at create time (via the resolved
  // `notification.channels` set), so this strategy no longer consults preferences at delivery time —
  // the dispatcher only invokes it when `push` is in the resolved set.
  getTypeMock.mockReturnValue({ type: 'orders.shipped' } as never)
})

describe('mobilePushDeliveryStrategy', () => {
  it('skips unknown notification types', async () => {
    getTypeMock.mockReturnValue(undefined)
    const { ctx, em } = makeCtx({})
    await mobilePushDeliveryStrategy.deliver(ctx)
    expect(em.find).not.toHaveBeenCalled()
    expect(em.getKysely).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('skips when no push channel is configured for the tenant', async () => {
    const { ctx, em } = makeCtx({ channels: [], devices: [{ id: 'dev-1', pushToken: 'tok', pushProvider: 'fcm' }] })
    await mobilePushDeliveryStrategy.deliver(ctx)
    expect(em.getKysely).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('skips when the recipient has no push-capable devices', async () => {
    const { ctx, em } = makeCtx({ channels: [{ providerKey: 'fcm' }], devices: [] })
    await mobilePushDeliveryStrategy.deliver(ctx)
    expect(em.getKysely).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('skips when devices have no channel matching their provider', async () => {
    // Devices exist but their provider has no configured channel ⇒ no rows to insert, no enqueue.
    const { ctx, em } = makeCtx({
      channels: [{ providerKey: 'fcm' }],
      devices: [{ id: 'expo-1', pushToken: 'tok', pushProvider: 'expo' }],
    })
    await mobilePushDeliveryStrategy.deliver(ctx)
    expect(em.getKysely).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('inserts a pending delivery row per device and enqueues each', async () => {
    const { ctx, em, captured } = makeCtx({
      channels: [{ providerKey: 'fcm' }],
      devices: [
        { id: 'dev-1', pushToken: 'token-aaaaaaaa', pushProvider: 'fcm' },
        { id: 'dev-2', pushToken: 'token-bbbbbbbb', pushProvider: 'fcm' },
      ],
    })
    await mobilePushDeliveryStrategy.deliver(ctx)
    expect(captured.insertRows).toHaveLength(2)
    expect(enqueueMock).toHaveBeenCalledTimes(2)
    // Devices are loaded scoped to the notification's organization (null here), never tenant-wide,
    // so an org-scoped notification cannot fan out to a device registered under a different org.
    // The load routes through findWithDecryption (push_token is encrypted at rest), which forwards a
    // third `options` arg (undefined here) to em.find.
    expect(em.find).toHaveBeenCalledWith(
      deviceRef,
      expect.objectContaining({ organizationId: null }),
      undefined,
    )
    // provider snapshotted, last-8 token snapshot, never the full token.
    const firstRow = captured.insertRows![0]
    expect(firstRow.provider).toBe('fcm')
    expect(firstRow.token_snapshot).toBe('aaaaaaaa')
    expect(firstRow).not.toHaveProperty('push_token')
    expect(firstRow).not.toHaveProperty('pushToken')
    expect(firstRow.notification_id).toBe('notif-1')
    expect(firstRow.organization_id).toBeNull()
  })

  it('is idempotent on re-fan-out: enqueues only the rows ON CONFLICT actually inserted', async () => {
    // Simulate a redelivered subscriber event: the second run's INSERT ... ON CONFLICT DO NOTHING
    // finds both (notification, device) rows already present, so nothing is inserted → nothing enqueued.
    const { ctx, captured } = makeCtx({
      channels: [{ providerKey: 'fcm' }],
      devices: [
        { id: 'dev-1', pushToken: 'token-aaaaaaaa', pushProvider: 'fcm' },
        { id: 'dev-2', pushToken: 'token-bbbbbbbb', pushProvider: 'fcm' },
      ],
      insertResult: [],
    })
    await mobilePushDeliveryStrategy.deliver(ctx)
    expect(captured.conflictColumns).toEqual(['notification_id', 'user_device_id'])
    expect(captured.conflictWhere).toEqual(['notification_id', 'is not', null])
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('marks a row failed when its enqueue throws (no orphan pending row)', async () => {
    enqueueMock.mockRejectedValueOnce(new Error('queue down'))
    const { ctx, captured } = makeCtx({
      channels: [{ providerKey: 'fcm' }],
      devices: [{ id: 'dev-1', pushToken: 'token-aaaaaaaa', pushProvider: 'fcm' }],
      insertResult: [{ id: 'del-1' }],
    })
    await mobilePushDeliveryStrategy.deliver(ctx)
    expect(captured.updates).toHaveLength(1)
    expect(captured.updates[0].set).toMatchObject({ status: 'failed' })
    expect(String((captured.updates[0].set as Record<string, unknown>).last_error)).toContain('enqueue_failed')
    // Failed enqueues are batched into one UPDATE per reason via `where id in (...)`, guarded on
    // `status='pending'` so a row a worker already progressed is not clobbered back to failed.
    expect(captured.updates[0].wheres).toEqual([
      ['id', 'in', ['del-1']],
      ['status', '=', 'pending'],
    ])
  })

  it('batches multiple same-reason enqueue failures into a single UPDATE', async () => {
    enqueueMock.mockRejectedValue(new Error('queue down'))
    const { ctx, captured } = makeCtx({
      channels: [{ providerKey: 'fcm' }],
      devices: [
        { id: 'dev-1', pushToken: 'token-aaaaaaaa', pushProvider: 'fcm' },
        { id: 'dev-2', pushToken: 'token-bbbbbbbb', pushProvider: 'fcm' },
      ],
      insertResult: [{ id: 'del-1' }, { id: 'del-2' }],
    })
    await mobilePushDeliveryStrategy.deliver(ctx)
    // Both rows share the same failure reason ⇒ one UPDATE targeting both ids, guarded on 'pending'.
    expect(captured.updates).toHaveLength(1)
    expect(captured.updates[0].set).toMatchObject({ status: 'failed' })
    expect(captured.updates[0].wheres).toEqual([
      ['id', 'in', ['del-1', 'del-2']],
      ['status', '=', 'pending'],
    ])
  })

  it('routes each device to the push channel matching its provider', async () => {
    const { ctx, captured } = makeCtx({
      channels: [{ providerKey: 'apns' }, { providerKey: 'fcm' }],
      devices: [
        { id: 'ios-1', pushToken: 'ios-token-1', pushProvider: 'apns' },
        { id: 'android-1', pushToken: 'android-token-1', pushProvider: 'fcm' },
        // No expo channel configured ⇒ this device is skipped.
        { id: 'expo-1', pushToken: 'expo-token-1', pushProvider: 'expo' },
        // No provider on the device ⇒ skipped.
        { id: 'unknown-1', pushToken: 'unknown-token-1', pushProvider: null },
      ],
    })
    await mobilePushDeliveryStrategy.deliver(ctx)
    expect(captured.insertRows).toHaveLength(2)
    expect(enqueueMock).toHaveBeenCalledTimes(2)
    const providersByDevice = Object.fromEntries(
      captured.insertRows!.map((row) => [row.user_device_id, row.provider]),
    )
    expect(providersByDevice).toEqual({ 'ios-1': 'apns', 'android-1': 'fcm' })
  })

  it('threads caller data + pushOptions into the delivery payload', async () => {
    const { ctx, captured } = makeCtx({
      channels: [{ providerKey: 'fcm' }],
      devices: [{ id: 'dev-1', pushToken: 'token-aaaaaaaa', pushProvider: 'fcm' }],
      notification: { data: { orderId: 'o-1' }, pushOptions: { sound: 'chime.caf', badge: 3 } },
    })
    await mobilePushDeliveryStrategy.deliver(ctx)
    const row = captured.insertRows![0]
    const payload = decodePayload(row)
    expect(payload.data).toMatchObject({ orderId: 'o-1', notificationId: 'notif-1', type: 'orders.shipped' })
    expect(payload.options).toEqual({ sound: 'chime.caf', badge: 3 })
    expect(payload.silent).toBe(false)
    expect(row.silent).toBe(false)
  })

  it('reuses the default-locale copy for a device without a locale (no translation)', async () => {
    const { ctx, captured } = makeCtx({
      channels: [{ providerKey: 'fcm' }],
      devices: [{ id: 'dev-1', pushToken: 'token-aaaaaaaa', pushProvider: 'fcm' }],
      notification: { titleKey: 'orders.shipped.title', bodyKey: 'orders.shipped.body' },
    })
    await mobilePushDeliveryStrategy.deliver(ctx)
    const payload = decodePayload(captured.insertRows![0])
    // ctx.title/ctx.body are already resolved in the default locale upstream and reused verbatim.
    expect(payload.title).toBe('Shipped')
    expect(payload.body).toBe('Your order shipped')
  })

  it('translates the delivery copy into the device locale', async () => {
    registerAppDictionaryLoader(async () => ({}))
    registerModules([
      { translations: { pl: { orders: { shipped: { title: 'Wysłano {orderNumber}', body: 'W drodze' } } } } },
    ] as never)
    invalidateDictionaryCache()

    const { ctx, captured } = makeCtx({
      channels: [{ providerKey: 'fcm' }],
      // `pl-PL` also exercises locale normalization (region subtag stripped to `pl`).
      devices: [{ id: 'dev-pl', pushToken: 'token-pltoken1', pushProvider: 'fcm', locale: 'pl-PL' }],
      notification: {
        titleKey: 'orders.shipped.title',
        bodyKey: 'orders.shipped.body',
        titleVariables: { orderNumber: '42' },
      },
    })
    await mobilePushDeliveryStrategy.deliver(ctx)
    const payload = decodePayload(captured.insertRows![0])
    expect(payload.title).toBe('Wysłano 42')
    expect(payload.body).toBe('W drodze')
  })

  it('fans out a nonOptOut-typed notification (opt-out already resolved upstream)', async () => {
    getTypeMock.mockReturnValue({ type: 'auth.account.locked', nonOptOut: true } as never)
    const { ctx, captured } = makeCtx({
      channels: [{ providerKey: 'fcm' }],
      devices: [{ id: 'dev-1', pushToken: 'token-aaaaaaaa', pushProvider: 'fcm' }],
      notification: { type: 'auth.account.locked' },
    })
    await mobilePushDeliveryStrategy.deliver(ctx)
    expect(captured.insertRows).toHaveLength(1)
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    // A forced visible notification is not silent.
    expect(captured.insertRows![0].silent).toBe(false)
  })

  it('delivers a silent-typed notification as silent', async () => {
    getTypeMock.mockReturnValue({ type: 'orders.shipped', silent: true } as never)
    const { ctx, captured } = makeCtx({
      channels: [{ providerKey: 'fcm' }],
      devices: [{ id: 'dev-1', pushToken: 'token-aaaaaaaa', pushProvider: 'fcm' }],
    })
    await mobilePushDeliveryStrategy.deliver(ctx)
    // Silent controls delivery STYLE only; enforcement happened upstream at create time.
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const row = captured.insertRows![0]
    expect(row.silent).toBe(true)
    expect(decodePayload(row).silent).toBe(true)
  })
})
