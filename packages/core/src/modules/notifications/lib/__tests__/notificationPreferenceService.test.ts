import { getNotificationType } from '../notification-type-registry'
import { getNotificationTypeOverrides } from '../typeOverrides'
import { createNotificationPreferenceService } from '../notificationPreferenceService'

jest.mock('../notification-type-registry', () => ({
  getNotificationType: jest.fn(),
}))

jest.mock('../typeOverrides', () => ({
  getNotificationTypeOverrides: jest.fn(async () => new Map()),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: jest.fn(async (_em: unknown, phases: Array<() => unknown>) => {
    for (const phase of phases) await phase()
  }),
}))

const getTypeMock = getNotificationType as jest.MockedFunction<typeof getNotificationType>
const getStoredOverridesMock = getNotificationTypeOverrides as jest.MockedFunction<
  typeof getNotificationTypeOverrides
>

const TENANT = '00000000-0000-0000-0000-000000000001'
const scope = { tenantId: TENANT, userId: 'user-1' }

function makeEm() {
  const fork = {
    find: jest.fn(async () => [] as unknown[]),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
  }
  const em = { fork: jest.fn(() => fork) }
  return { em, fork }
}

describe('notificationPreferenceService.setPreferences', () => {
  beforeEach(() => {
    getTypeMock.mockReset()
    getTypeMock.mockReturnValue(undefined)
    getStoredOverridesMock.mockReset()
    getStoredOverridesMock.mockResolvedValue(new Map())
  })

  it('persists preferences for ordinary (opt-out-able) types', async () => {
    const { em, fork } = makeEm()
    const service = createNotificationPreferenceService({ em } as never)
    await service.setPreferences(scope, [{ typeId: 'orders.shipped', channel: 'push', enabled: false }])
    expect(fork.create).toHaveBeenCalledTimes(1)
    expect(fork.persist).toHaveBeenCalledTimes(1)
  })

  it('refuses to store an opt-out row for a nonOptOut type', async () => {
    getTypeMock.mockImplementation((type) =>
      type === 'auth.account.locked' ? ({ type, nonOptOut: true } as never) : undefined,
    )
    const { em, fork } = makeEm()
    const service = createNotificationPreferenceService({ em } as never)
    await service.setPreferences(scope, [{ typeId: 'auth.account.locked', channel: 'push', enabled: false }])
    // No writable items ⇒ never creates a row (the single fork is the overrides read).
    expect(fork.create).not.toHaveBeenCalled()
  })

  it('allows an enabled: true row for a nonOptOut type (matches the forced-on state)', async () => {
    getTypeMock.mockImplementation((type) =>
      type === 'auth.account.locked' ? ({ type, nonOptOut: true } as never) : undefined,
    )
    const { em, fork } = makeEm()
    const service = createNotificationPreferenceService({ em } as never)
    await service.setPreferences(scope, [{ typeId: 'auth.account.locked', channel: 'push', enabled: true }])
    expect(fork.create).toHaveBeenCalledTimes(1)
    const created = fork.create.mock.calls[0][1] as Record<string, unknown>
    expect(created.notificationTypeId).toBe('auth.account.locked')
    expect(created.enabled).toBe(true)
  })

  it('drops only the nonOptOut items from a mixed batch', async () => {
    getTypeMock.mockImplementation((type) =>
      type === 'auth.account.locked' ? ({ type, nonOptOut: true } as never) : undefined,
    )
    const { em, fork } = makeEm()
    const service = createNotificationPreferenceService({ em } as never)
    await service.setPreferences(scope, [
      { typeId: 'auth.account.locked', channel: 'push', enabled: false },
      { typeId: 'orders.shipped', channel: 'push', enabled: false },
    ])
    expect(fork.create).toHaveBeenCalledTimes(1)
    const created = fork.create.mock.calls[0][1] as Record<string, unknown>
    expect(created.notificationTypeId).toBe('orders.shipped')
  })

  it('drops writes for a channel outside the stored eligibility override', async () => {
    getStoredOverridesMock.mockResolvedValue(new Map([['orders.shipped', { channels: ['in_app', 'email'], nonOptOut: null }]]))
    const { em, fork } = makeEm()
    const service = createNotificationPreferenceService({ em } as never)
    const changed = await service.setPreferences(scope, [
      { typeId: 'orders.shipped', channel: 'push', enabled: true },
      { typeId: 'orders.shipped', channel: 'email', enabled: false },
    ])
    expect(changed).toBe(1)
    expect(fork.create).toHaveBeenCalledTimes(1)
    const created = fork.create.mock.calls[0][1] as Record<string, unknown>
    expect(created.channel).toBe('email')
  })

  it('reads the stored overrides scoped to the caller tenant', async () => {
    const { em } = makeEm()
    const service = createNotificationPreferenceService({ em } as never)
    await service.setPreferences(scope, [{ typeId: 'orders.shipped', channel: 'push', enabled: true }])
    expect(getStoredOverridesMock).toHaveBeenCalledTimes(1)
    expect(getStoredOverridesMock.mock.calls[0]![1]).toBe(TENANT)
    expect(getStoredOverridesMock.mock.calls[0]![2]).toEqual(['orders.shipped'])
  })

  it('drops writes for a channel outside the code-declared eligibility (no override)', async () => {
    getTypeMock.mockImplementation((type) =>
      type === 'orders.shipped' ? ({ type, channels: ['in_app', 'email'] } as never) : undefined,
    )
    const { em, fork } = makeEm()
    const service = createNotificationPreferenceService({ em } as never)
    const changed = await service.setPreferences(scope, [
      { typeId: 'orders.shipped', channel: 'push', enabled: true },
    ])
    expect(changed).toBe(0)
    expect(fork.create).not.toHaveBeenCalled()
  })

  it('a stored override re-opening a channel lets the write through despite the code set', async () => {
    getTypeMock.mockImplementation((type) =>
      type === 'orders.shipped' ? ({ type, channels: ['in_app', 'email'] } as never) : undefined,
    )
    getStoredOverridesMock.mockResolvedValue(new Map([['orders.shipped', { channels: ['in_app', 'email', 'push'], nonOptOut: null }]]))
    const { em, fork } = makeEm()
    const service = createNotificationPreferenceService({ em } as never)
    const changed = await service.setPreferences(scope, [
      { typeId: 'orders.shipped', channel: 'push', enabled: false },
    ])
    expect(changed).toBe(1)
    expect(fork.create).toHaveBeenCalledTimes(1)
  })

  it('refuses an opt-out when the stored nonOptOut override forces the type on', async () => {
    getStoredOverridesMock.mockResolvedValue(new Map([['orders.shipped', { channels: null, nonOptOut: true }]]))
    const { em, fork } = makeEm()
    const service = createNotificationPreferenceService({ em } as never)
    const changed = await service.setPreferences(scope, [
      { typeId: 'orders.shipped', channel: 'push', enabled: false },
    ])
    expect(changed).toBe(0)
    expect(fork.create).not.toHaveBeenCalled()
  })

  it('allows an opt-out when the stored override relaxes a code-required type', async () => {
    getTypeMock.mockImplementation((type) =>
      type === 'auth.account.locked' ? ({ type, nonOptOut: true } as never) : undefined,
    )
    getStoredOverridesMock.mockResolvedValue(new Map([['auth.account.locked', { channels: null, nonOptOut: false }]]))
    const { em, fork } = makeEm()
    const service = createNotificationPreferenceService({ em } as never)
    const changed = await service.setPreferences(scope, [
      { typeId: 'auth.account.locked', channel: 'push', enabled: false },
    ])
    expect(changed).toBe(1)
    expect(fork.create).toHaveBeenCalledTimes(1)
  })
})
