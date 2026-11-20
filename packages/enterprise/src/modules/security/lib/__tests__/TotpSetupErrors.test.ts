import { TOTP } from 'otpauth'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { mapMfaError } from '../../api/mfa/_shared'
import pl from '../../i18n/pl.json'
import en from '../../i18n/en.json'
import { TotpProvider } from '../providers/TotpProvider'
import { defaultSecurityModuleConfig } from '../security-config'

let mockLocale: 'en' | 'pl' = 'en'

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn(async () => 'data:image/png;base64,test') },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback: string) => {
      const dictionary: Record<string, string> = mockLocale === 'pl' ? pl : en
      return dictionary[key] ?? fallback
    },
  }),
}))

describe('TOTP setup client errors', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-11-19T12:00:00Z'))
    mockLocale = 'en'
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  test.each(['en', 'pl'] as const)('maps a mocked invalid code to a localized 400 in %s and permits retry', async (locale) => {
    mockLocale = locale
    const provider = new TotpProvider(defaultSecurityModuleConfig, 'unit-test-setup-secret')
    const setup = await provider.setup('user-1', {})
    const validate = jest.spyOn(TOTP.prototype, 'validate').mockReturnValueOnce(null).mockReturnValueOnce(0)

    const error = await provider.confirmSetup('user-1', setup.setupId, { code: '123456' }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(CrudHttpError)
    const response = await mapMfaError(error)

    expect(response.status).toBe(400)
    const dictionary = locale === 'pl' ? pl : en
    await expect(response.json()).resolves.toEqual({ error: dictionary['security.api.errors.invalidTotpCode'] })
    await expect(provider.confirmSetup('user-1', setup.setupId, { code: '123456' })).resolves.toEqual({
      metadata: {},
      secret: setup.clientData.secret,
    })
    expect(validate).toHaveBeenCalledTimes(2)
  })

  test('maps a missing setup to a localized 404 before verification', async () => {
    const provider = new TotpProvider(defaultSecurityModuleConfig, 'unit-test-setup-secret')
    const validate = jest.spyOn(TOTP.prototype, 'validate')
    const error = await provider.confirmSetup('user-1', 'missing-setup', { code: '123456' }).catch((error: unknown) => error)
    const response = await mapMfaError(error)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: en['security.api.errors.totpSetupSessionNotFound'] })
    expect(validate).not.toHaveBeenCalled()
  })

  test('maps an expired setup to a localized 400 before verification', async () => {
    const provider = new TotpProvider(defaultSecurityModuleConfig, 'unit-test-setup-secret')
    const setup = await provider.setup('user-1', {})
    const validate = jest.spyOn(TOTP.prototype, 'validate')
    jest.advanceTimersByTime(defaultSecurityModuleConfig.totp.setupTtlMs + 1)
    const error = await provider.confirmSetup('user-1', setup.setupId, { code: '123456' }).catch((error: unknown) => error)
    const response = await mapMfaError(error)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: en['security.api.errors.totpSetupSessionExpired'] })
    expect(validate).not.toHaveBeenCalled()
  })

  test('localizes setup errors created by a separate module instance', async () => {
    mockLocale = 'pl'
    let error: unknown
    jest.isolateModules(() => {
      const isolatedErrors = jest.requireActual<typeof import('@open-mercato/shared/lib/crud/errors')>('@open-mercato/shared/lib/crud/errors')
      error = isolatedErrors.badRequest('Invalid TOTP code')
    })

    expect(error).not.toBeInstanceOf(CrudHttpError)
    const response = await mapMfaError(error)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: pl['security.api.errors.invalidTotpCode'] })
  })

  test('keeps unexpected failures behind the generic 500 response', async () => {
    const response = await mapMfaError(new Error('Unexpected internal failure'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: en['security.api.errors.mfaRequestFailed'] })
  })
})
