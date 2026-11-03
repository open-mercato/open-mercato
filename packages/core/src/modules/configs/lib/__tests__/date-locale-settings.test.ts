const getAuthFromCookiesMock = jest.fn()
const getRecordMock = jest.fn()
const lookupMock = jest.fn()

const container = {
  hasRegistration: jest.fn((name: string) => name === 'userTimeZoneLookup'),
  resolve: jest.fn((name: string) => {
    if (name === 'moduleConfigService') return { getRecord: (...args: unknown[]) => getRecordMock(...args) }
    if (name === 'userTimeZoneLookup') return (...args: unknown[]) => lookupMock(...args)
    throw new Error(`Unexpected resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: (...args: unknown[]) => getAuthFromCookiesMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

import { normalizeStoredDateLocaleSettings, resolveDateLocaleSettingsFromCookies } from '../date-locale-settings'

const tenantId = '11111111-1111-4111-8111-111111111111'
const userId = '33333333-3333-4333-8333-333333333333'

describe('resolveDateLocaleSettingsFromCookies', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getRecordMock.mockResolvedValue({ value: { timeZone: 'Europe/Warsaw' }, source: 'tenant', updatedAt: '2026-11-01T00:00:00.000Z' })
    lookupMock.mockResolvedValue('Asia/Tokyo')
  })

  it('returns null for anonymous requests', async () => {
    getAuthFromCookiesMock.mockResolvedValue(null)
    await expect(resolveDateLocaleSettingsFromCookies()).resolves.toBeNull()
    expect(getRecordMock).not.toHaveBeenCalled()
  })

  it('applies the signed-in user time zone over the tenant', async () => {
    getAuthFromCookiesMock.mockResolvedValue({ tenantId, sub: userId })
    const resolved = await resolveDateLocaleSettingsFromCookies()
    expect(resolved?.timeZone).toBe('Asia/Tokyo')
    expect(lookupMock).toHaveBeenCalledWith({ userId, tenantId })
  })

  it('never treats an API key as a user', async () => {
    getAuthFromCookiesMock.mockResolvedValue({ tenantId, sub: 'api_key:abc', isApiKey: true })
    const resolved = await resolveDateLocaleSettingsFromCookies()
    expect(lookupMock).not.toHaveBeenCalled()
    expect(resolved?.timeZone).toBe('Europe/Warsaw')
  })

  it('returns null instead of throwing when the lookup fails', async () => {
    getAuthFromCookiesMock.mockResolvedValue({ tenantId, sub: userId })
    getRecordMock.mockRejectedValue(new Error('database unavailable'))
    await expect(resolveDateLocaleSettingsFromCookies()).resolves.toBeNull()
  })
})

describe('normalizeStoredDateLocaleSettings', () => {
  it('drops each invalid field independently', () => {
    expect(
      normalizeStoredDateLocaleSettings({ timeZone: '+01:00', dateFormat: 'dd.MM.yyyy', timeFormat: 'HH:mm f', locale: 'en-GB' }),
    ).toEqual({
      locale: 'en-GB',
      dateFormat: 'dd.MM.yyyy',
      dateTimeFormat: null,
      timeFormat: null,
      timeZone: null,
      firstDayOfWeek: null,
    })
  })
})
