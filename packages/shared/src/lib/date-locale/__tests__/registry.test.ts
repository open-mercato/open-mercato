import {
  registerDateLocaleSettingsResolver,
  registerDateLocaleSettingsScopeResolver,
  resolveDateLocaleSettingsForRequest,
  resolveDateLocaleSettingsForScope,
} from '../registry'
import { resolveDateLocaleSettings } from '../resolve'

const configured = resolveDateLocaleSettings({
  tenant: { timeZone: 'Europe/Warsaw' },
  env: { locale: null, dateFormat: null, dateTimeFormat: null, timeFormat: null, timeZone: null, firstDayOfWeek: null },
})
const container = { resolve: jest.fn() }

describe('date/locale resolver registry', () => {
  const originalTimeZone = process.env.OM_DEFAULT_TIMEZONE

  beforeEach(() => {
    registerDateLocaleSettingsResolver(null)
    registerDateLocaleSettingsScopeResolver(null)
    process.env.OM_DEFAULT_TIMEZONE = 'UTC'
  })

  afterAll(() => {
    registerDateLocaleSettingsResolver(null)
    registerDateLocaleSettingsScopeResolver(null)
    if (originalTimeZone === undefined) delete process.env.OM_DEFAULT_TIMEZONE
    else process.env.OM_DEFAULT_TIMEZONE = originalTimeZone
  })

  describe('resolveDateLocaleSettingsForRequest', () => {
    it('falls back to env defaults when no resolver is registered', async () => {
      const resolved = await resolveDateLocaleSettingsForRequest()
      expect(resolved.timeZone).toBe('UTC')
      expect(resolved.sources.timeZone).toBe('env')
    })

    it('falls back to env defaults when the resolver has no tenant context', async () => {
      registerDateLocaleSettingsResolver(async () => null)
      expect((await resolveDateLocaleSettingsForRequest()).timeZone).toBe('UTC')
    })

    it('falls back to env defaults instead of throwing when the resolver fails', async () => {
      registerDateLocaleSettingsResolver(async () => {
        throw new Error('database unavailable')
      })
      await expect(resolveDateLocaleSettingsForRequest()).resolves.toMatchObject({ timeZone: 'UTC' })
    })

    it('returns the registered resolver result', async () => {
      registerDateLocaleSettingsResolver(async () => configured)
      expect((await resolveDateLocaleSettingsForRequest()).timeZone).toBe('Europe/Warsaw')
    })
  })

  describe('resolveDateLocaleSettingsForScope', () => {
    it('skips the resolver without a tenant', async () => {
      const resolver = jest.fn(async () => configured)
      registerDateLocaleSettingsScopeResolver(resolver)
      const resolved = await resolveDateLocaleSettingsForScope(container, { tenantId: '' })
      expect(resolver).not.toHaveBeenCalled()
      expect(resolved.timeZone).toBe('UTC')
    })

    it('passes the tenant and user to the resolver', async () => {
      const resolver = jest.fn(async () => configured)
      registerDateLocaleSettingsScopeResolver(resolver)
      await expect(resolveDateLocaleSettingsForScope(container, { tenantId: 't-1', userId: 'u-1' })).resolves.toBe(configured)
      expect(resolver).toHaveBeenCalledWith(container, { tenantId: 't-1', userId: 'u-1' })
    })

    it('falls back to env defaults when the resolver throws', async () => {
      registerDateLocaleSettingsScopeResolver(async () => {
        throw new Error('boom')
      })
      await expect(resolveDateLocaleSettingsForScope(container, { tenantId: 't-1' })).resolves.toMatchObject({ timeZone: 'UTC' })
    })
  })
})
