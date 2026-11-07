const getAuthFromCookiesMock = jest.fn()
const getRecordMock = jest.fn()
const lookupMock = jest.fn()
const reportErrorMock = jest.fn()

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

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

import { getCurrentCacheTenant } from '@open-mercato/cache'
import {
  normalizeStoredDateLocaleSettings,
  resolveDateLocaleSettingsForScopeWithReporting,
  resolveDateLocaleSettingsFromCookies,
} from '../date-locale-settings'

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

  // Page renders run outside the API dispatcher's cache-tenant context. The read must still use
  // the tenant's cache namespace, the one a settings save writes, or the layout shows stale settings.
  it('reads the stored settings inside the tenant cache namespace', async () => {
    getAuthFromCookiesMock.mockResolvedValue({ tenantId, sub: userId })
    let cacheTenant: string | null | undefined
    getRecordMock.mockImplementation(async () => {
      cacheTenant = getCurrentCacheTenant()
      return { value: { timeZone: 'Europe/Warsaw' }, source: 'tenant', updatedAt: '2026-11-01T00:00:00.000Z' }
    })
    expect(getCurrentCacheTenant()).toBeNull()
    await resolveDateLocaleSettingsFromCookies()
    expect(cacheTenant).toBe(tenantId)
  })

  it('never treats an API key as a user', async () => {
    getAuthFromCookiesMock.mockResolvedValue({ tenantId, sub: 'api_key:abc', isApiKey: true })
    const resolved = await resolveDateLocaleSettingsFromCookies()
    expect(lookupMock).not.toHaveBeenCalled()
    expect(resolved?.timeZone).toBe('Europe/Warsaw')
  })

  it('returns null instead of throwing when the lookup fails, and reports the failure', async () => {
    getAuthFromCookiesMock.mockResolvedValue({ tenantId, sub: userId })
    const failure = new Error('database unavailable')
    getRecordMock.mockRejectedValue(failure)
    await expect(resolveDateLocaleSettingsFromCookies()).resolves.toBeNull()
    expect(reportErrorMock).toHaveBeenCalledWith(failure, { module: 'configs', code: 'configs.date_locale.resolve_failed' })
  })

  it('treats a render without a request scope as anonymous, without reporting it', async () => {
    getAuthFromCookiesMock.mockRejectedValue(new Error('cookies() was called outside a request scope'))
    await expect(resolveDateLocaleSettingsFromCookies()).resolves.toBeNull()
    expect(reportErrorMock).not.toHaveBeenCalled()
  })

  it('falls back to the tenant zone and reports when the user time zone lookup fails', async () => {
    getAuthFromCookiesMock.mockResolvedValue({ tenantId, sub: userId })
    const failure = new Error('users table unavailable')
    lookupMock.mockRejectedValue(failure)
    const resolved = await resolveDateLocaleSettingsFromCookies()
    expect(resolved?.timeZone).toBe('Europe/Warsaw')
    expect(reportErrorMock).toHaveBeenCalledWith(failure, { module: 'configs', code: 'configs.date_locale.user_time_zone_failed' })
  })
})

describe('an all-empty tenant row', () => {
  const emptyRow = {
    locale: null,
    dateFormat: null,
    dateTimeFormat: null,
    timeFormat: null,
    timeZone: null,
    firstDayOfWeek: null,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    lookupMock.mockResolvedValue(null)
  })

  it('resolves exactly like no row, so restoring a missing row with empty values is safe', async () => {
    getRecordMock.mockResolvedValue(null)
    const withoutRow = await resolveDateLocaleSettingsForScopeWithReporting(container, { tenantId })
    getRecordMock.mockResolvedValue({ value: emptyRow, source: 'tenant', updatedAt: '2026-11-01T00:00:00.000Z' })
    const withEmptyRow = await resolveDateLocaleSettingsForScopeWithReporting(container, { tenantId })
    expect(withEmptyRow).toEqual(withoutRow)
  })
})

describe('resolveDateLocaleSettingsForScopeWithReporting', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    lookupMock.mockResolvedValue(null)
  })

  it('resolves the tenant settings', async () => {
    getRecordMock.mockResolvedValue({ value: { timeZone: 'Europe/Warsaw' }, source: 'tenant', updatedAt: null })
    const resolved = await resolveDateLocaleSettingsForScopeWithReporting(container, { tenantId })
    expect(resolved.timeZone).toBe('Europe/Warsaw')
    expect(reportErrorMock).not.toHaveBeenCalled()
  })

  it('reports a failed lookup and rethrows so the shared registry falls back', async () => {
    const failure = new Error('database unavailable')
    getRecordMock.mockRejectedValue(failure)
    await expect(resolveDateLocaleSettingsForScopeWithReporting(container, { tenantId })).rejects.toBe(failure)
    expect(reportErrorMock).toHaveBeenCalledWith(failure, { module: 'configs', code: 'configs.date_locale.scope_resolve_failed' })
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
