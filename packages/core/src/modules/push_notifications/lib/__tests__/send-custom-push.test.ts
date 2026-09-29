import { getNotificationType } from '@open-mercato/core/modules/notifications/lib/notification-type-registry'
import { fanOutPushDeliveries } from '../push-fanout'
import { sendCustomPush } from '../send-custom-push'
import { ADMIN_CUSTOM_MESSAGE_TYPE, ADMIN_CUSTOM_SILENT_TYPE } from '../../notifications'

jest.mock('@open-mercato/core/modules/notifications/lib/notification-type-registry', () => ({
  getNotificationType: jest.fn(),
}))

jest.mock('../push-fanout', () => ({
  fanOutPushDeliveries: jest.fn(async () => ({ enqueued: 2 })),
}))

const getTypeMock = getNotificationType as jest.MockedFunction<typeof getNotificationType>
const fanOutMock = fanOutPushDeliveries as jest.MockedFunction<typeof fanOutPushDeliveries>

const TENANT = '00000000-0000-0000-0000-000000000001'
const resolve = (<T,>(name: string): T => ({ em: { __em: true } }[name] as T))

beforeEach(() => {
  getTypeMock.mockReset()
  fanOutMock.mockClear()
  fanOutMock.mockResolvedValue({ enqueued: 2 })
})

describe('sendCustomPush', () => {
  it('throws when the type is not registered', async () => {
    getTypeMock.mockReturnValue(undefined)
    await expect(
      sendCustomPush({ resolve, tenantId: TENANT, userId: 'u-1', title: 'Hi' }),
    ).rejects.toThrow(/not registered/)
    expect(fanOutMock).not.toHaveBeenCalled()
  })

  it('throws when the type silent flag does not match the requested mode', async () => {
    // A visible send (silent defaults false) must not target a silent-declared type.
    getTypeMock.mockReturnValue({ type: ADMIN_CUSTOM_MESSAGE_TYPE, silent: true } as never)
    await expect(
      sendCustomPush({ resolve, tenantId: TENANT, userId: 'u-1', title: 'Hi' }),
    ).rejects.toThrow(/does not match requested silent/)
    expect(fanOutMock).not.toHaveBeenCalled()
  })

  it('forwards deviceId to the fan-out as userDeviceId (single-device target)', async () => {
    getTypeMock.mockReturnValue({ type: ADMIN_CUSTOM_MESSAGE_TYPE, silent: false } as never)
    await sendCustomPush({ resolve, tenantId: TENANT, userId: 'u-1', title: 'Hi', deviceId: 'dev-9' })
    expect(fanOutMock.mock.calls[0][0].userDeviceId).toBe('dev-9')
  })

  it('fans out a silent, data-only payload under the silent type when silent is requested', async () => {
    getTypeMock.mockReturnValue({ type: ADMIN_CUSTOM_SILENT_TYPE, silent: true } as never)
    const result = await sendCustomPush({
      resolve,
      tenantId: TENANT,
      userId: 'u-1',
      title: 'wake',
      silent: true,
      data: { k: 'v' },
    })
    expect(result).toEqual({ enqueued: 2 })
    const args = fanOutMock.mock.calls[0][0]
    expect(args.notificationTypeId).toBe(ADMIN_CUSTOM_SILENT_TYPE)
    expect(args.payload.silent).toBe(true)
    expect(args.payload.data).toEqual({ k: 'v', type: ADMIN_CUSTOM_SILENT_TYPE })
  })

  it('fans out a visible payload with literal title/body, no notification id, and the type folded into data', async () => {
    getTypeMock.mockReturnValue({ type: ADMIN_CUSTOM_MESSAGE_TYPE, silent: false } as never)
    const result = await sendCustomPush({
      resolve,
      tenantId: TENANT,
      userId: 'u-1',
      organizationId: 'org-1',
      title: 'Scheduled maintenance',
      body: 'The app will be down at 02:00 UTC.',
      data: { ticketId: 't-1' },
      pushOptions: { sound: 'default', badge: 1 },
    })
    expect(result).toEqual({ enqueued: 2 })
    expect(fanOutMock).toHaveBeenCalledTimes(1)
    const args = fanOutMock.mock.calls[0][0]
    expect(args.notificationId).toBeNull()
    expect(args.notificationTypeId).toBe(ADMIN_CUSTOM_MESSAGE_TYPE)
    expect(args.scope).toEqual({ tenantId: TENANT, organizationId: 'org-1' })
    // No `copy` — literal admin text is delivered verbatim (no per-device translation).
    expect(args.copy).toBeUndefined()
    expect(args.payload.silent).toBe(false)
    expect(args.payload.title).toBe('Scheduled maintenance')
    expect(args.payload.body).toBe('The app will be down at 02:00 UTC.')
    expect(args.payload.data).toEqual({ ticketId: 't-1', type: ADMIN_CUSTOM_MESSAGE_TYPE })
    expect(args.payload.options).toEqual({ sound: 'default', badge: 1 })
  })
})
