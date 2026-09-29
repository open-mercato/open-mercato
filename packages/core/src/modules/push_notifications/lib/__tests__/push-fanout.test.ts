import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveNotificationCopy } from '@open-mercato/core/modules/notifications/lib/notificationCopy'
import { enqueuePushDelivery } from '../queue'
import { fanOutPushDeliveries } from '../push-fanout'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationCopy', () => ({
  resolveNotificationCopy: jest.fn(async () => ({ title: 'translated-title', body: 'translated-body' })),
}))

jest.mock('../queue', () => ({
  enqueuePushDelivery: jest.fn(async () => 'job-id'),
  PUSH_DELIVERIES_QUEUE: 'push-deliveries',
}))

// The fan-out builds each row's payload as a `sql\`${json}::jsonb\`` fragment. Replace the tag with a
// capturing stub so the test can read back the JSON without compiling real SQL.
jest.mock('kysely', () => ({
  ...jest.requireActual('kysely'),
  sql: (_strings: TemplateStringsArray, ...values: unknown[]) => ({ __rawJson: values[0] }),
}))

function decodePayload(row: Record<string, unknown>): { title?: string; body?: string | null; data?: Record<string, string>; options?: Record<string, unknown>; silent?: boolean } {
  return JSON.parse((row.payload as { __rawJson: string }).__rawJson)
}

const findWithDecryptionMock = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>
const resolveCopyMock = resolveNotificationCopy as jest.MockedFunction<typeof resolveNotificationCopy>
const enqueueMock = enqueuePushDelivery as jest.MockedFunction<typeof enqueuePushDelivery>

const TENANT = '00000000-0000-0000-0000-000000000001'
const channelRef = { __entity: 'CommunicationChannel' }
const deviceRef = { __entity: 'UserDevice' }

const resolve = (<T,>(name: string): T => (({
  CommunicationChannel: channelRef,
  UserDevice: deviceRef,
} as Record<string, unknown>)[name] as T))

function makeChannel(overrides: Record<string, unknown> = {}) {
  return { id: 'chan-1', providerKey: 'apns', channelType: 'push', isActive: true, deletedAt: null, ...overrides }
}

function makeDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dev-1',
    tenantId: TENANT,
    userId: 'user-1',
    pushProvider: 'apns',
    pushToken: 'super-secret-token-abcd1234',
    locale: null,
    deletedAt: null,
    ...overrides,
  }
}

// Minimal chainable stub for the `em.getKysely()` builder used by the fan-out insert. `insertResult`
// controls which rows the INSERT ... ON CONFLICT DO NOTHING reports as actually inserted (undefined ⇒
// one `del-N` row per input row, i.e. no conflict). `created` aliases the captured insert rows so the
// existing assertions keep reading the persisted delivery rows.
function makeEm(channels: Array<Record<string, unknown>>, insertResult?: Array<{ id: string }>) {
  const captured: {
    insertRows: Array<Record<string, unknown>>
    updates: Array<{ set: Record<string, unknown>; wheres: unknown[][] }>
  } = { insertRows: [], updates: [] }

  const insertBuilder: Record<string, unknown> = {
    values: (rows: Array<Record<string, unknown>>) => {
      captured.insertRows.push(...rows)
      return insertBuilder
    },
    onConflict: (cb: (oc: unknown) => unknown) => {
      const oc: Record<string, unknown> = {
        columns: () => oc,
        where: () => oc,
        doNothing: () => oc,
      }
      cb(oc)
      return insertBuilder
    },
    returning: () => insertBuilder,
    execute: async () => insertResult ?? captured.insertRows.map((_, index) => ({ id: `del-${index + 1}` })),
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

  const em = {
    find: jest.fn(async () => channels),
    getKysely: jest.fn(() => db),
  }
  return { em, captured, created: captured.insertRows }
}

const baseArgs = {
  scope: { tenantId: TENANT, organizationId: null as string | null },
  userId: 'user-1',
  notificationId: 'notif-1',
  notificationTypeId: 'orders.shipped',
  payload: { title: 'Hi', body: 'There', data: {} as Record<string, string> },
}

beforeEach(() => {
  findWithDecryptionMock.mockReset()
  findWithDecryptionMock.mockResolvedValue([])
  resolveCopyMock.mockClear()
  enqueueMock.mockReset()
  enqueueMock.mockResolvedValue('job-id')
})

describe('fanOutPushDeliveries', () => {
  it('skips entirely (no device load) when the tenant has no active push channel', async () => {
    const { em } = makeEm([])
    const result = await fanOutPushDeliveries({ em: em as never, resolve, ...baseArgs })
    expect(result).toEqual({ enqueued: 0 })
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('skips when the recipient has no push-capable devices', async () => {
    const { em } = makeEm([makeChannel()])
    findWithDecryptionMock.mockResolvedValue([])
    const result = await fanOutPushDeliveries({ em: em as never, resolve, ...baseArgs })
    expect(result).toEqual({ enqueued: 0 })
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('decrypts devices scoped to the tenant + organization', async () => {
    const { em } = makeEm([makeChannel()])
    findWithDecryptionMock.mockResolvedValue([makeDevice()] as never)
    await fanOutPushDeliveries({
      em: em as never,
      resolve,
      ...baseArgs,
      scope: { tenantId: TENANT, organizationId: 'org-9' },
    })
    const call = findWithDecryptionMock.mock.calls[0]
    expect(call[2]).toMatchObject({ tenantId: TENANT, userId: 'user-1', deletedAt: null })
    expect(call[4]).toEqual({ tenantId: TENANT, organizationId: 'org-9' })
  })

  it('persists only the truncated token snapshot, never the full secret', async () => {
    const { em, created } = makeEm([makeChannel()])
    findWithDecryptionMock.mockResolvedValue([makeDevice()] as never)
    await fanOutPushDeliveries({ em: em as never, resolve, ...baseArgs })
    expect(created).toHaveLength(1)
    expect(created[0].token_snapshot).toBe('abcd1234')
    expect(JSON.stringify(created)).not.toContain('super-secret-token')
  })

  it('routes each device to its provider channel and skips devices with no/unknown provider', async () => {
    const { em, created } = makeEm([makeChannel({ providerKey: 'apns' }), makeChannel({ id: 'chan-2', providerKey: 'fcm' })])
    findWithDecryptionMock.mockResolvedValue([
      makeDevice({ id: 'dev-apns', pushProvider: 'apns' }),
      makeDevice({ id: 'dev-fcm', pushProvider: 'fcm' }),
      makeDevice({ id: 'dev-none', pushProvider: null }),
      makeDevice({ id: 'dev-expo', pushProvider: 'expo' }),
    ] as never)
    const result = await fanOutPushDeliveries({ em: em as never, resolve, ...baseArgs })
    expect(result).toEqual({ enqueued: 2 })
    expect(created.map((row) => row.user_device_id)).toEqual(['dev-apns', 'dev-fcm'])
    expect(created.map((row) => row.provider)).toEqual(['apns', 'fcm'])
  })

  it('deduplicates channels by provider (first active channel wins)', async () => {
    const { em, created } = makeEm([
      makeChannel({ id: 'chan-primary', providerKey: 'apns' }),
      makeChannel({ id: 'chan-secondary', providerKey: 'apns' }),
    ])
    findWithDecryptionMock.mockResolvedValue([makeDevice({ pushProvider: 'apns' })] as never)
    await fanOutPushDeliveries({ em: em as never, resolve, ...baseArgs })
    expect(created).toHaveLength(1)
    expect(created[0].provider).toBe('apns')
  })

  it('marks the row failed and excludes it from the count when enqueue throws', async () => {
    const { em, created, captured } = makeEm([makeChannel()])
    findWithDecryptionMock.mockResolvedValue([
      makeDevice({ id: 'dev-1' }),
      makeDevice({ id: 'dev-2' }),
    ] as never)
    enqueueMock.mockResolvedValueOnce('job-1').mockRejectedValueOnce(new Error('broker down'))
    const result = await fanOutPushDeliveries({ em: em as never, resolve, ...baseArgs })
    expect(result).toEqual({ enqueued: 1 })
    // Every device is inserted `pending`; the enqueue failure transitions only the failed row.
    expect(created.map((row) => row.status)).toEqual(['pending', 'pending'])
    // The second device's enqueue rejected → a single grouped UPDATE flips it to `failed`.
    expect(captured.updates).toHaveLength(1)
    expect(captured.updates[0].set).toMatchObject({ status: 'failed', last_error: 'enqueue_failed: broker down' })
    // Guarded on both the id set and `status='pending'` so a row a worker already progressed is not clobbered.
    expect(captured.updates[0].wheres).toEqual([
      ['id', 'in', ['del-2']],
      ['status', '=', 'pending'],
    ])
  })

  it('reuses the upstream copy for default-locale devices and translates for other locales', async () => {
    const { em, created } = makeEm([makeChannel()])
    findWithDecryptionMock.mockResolvedValue([
      makeDevice({ id: 'dev-en', locale: 'en' }),
      makeDevice({ id: 'dev-null', locale: null }),
      makeDevice({ id: 'dev-de', locale: 'de' }),
    ] as never)
    await fanOutPushDeliveries({
      em: em as never,
      resolve,
      ...baseArgs,
      copy: { title: 'Order shipped', body: 'It is on the way', titleKey: 'orders.shipped.title' } as never,
    })
    expect(decodePayload(created[0])).toMatchObject({ title: 'Order shipped', body: 'It is on the way' })
    expect(decodePayload(created[1])).toMatchObject({ title: 'Order shipped', body: 'It is on the way' })
    expect(decodePayload(created[2])).toMatchObject({ title: 'translated-title', body: 'translated-body' })
    // Only the non-default locale triggers a dictionary translation.
    expect(resolveCopyMock).toHaveBeenCalledTimes(1)
    expect(resolveCopyMock.mock.calls[0][1]).toBe('de')
  })

  it('fans out a silent payload without resolving any copy', async () => {
    const { em, created } = makeEm([makeChannel()])
    findWithDecryptionMock.mockResolvedValue([makeDevice()] as never)
    const result = await fanOutPushDeliveries({
      em: em as never,
      resolve,
      ...baseArgs,
      notificationId: null,
      payload: { data: { type: 'sync.data.updated' }, silent: true },
    })
    expect(result).toEqual({ enqueued: 1 })
    expect(created[0].silent).toBe(true)
    expect(created[0].notification_id).toBeNull()
    expect(resolveCopyMock).not.toHaveBeenCalled()
  })
})
