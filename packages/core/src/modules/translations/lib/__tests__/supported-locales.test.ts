const getAuthFromCookies = jest.fn()
const createRequestContainer = jest.fn()
const getValue = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: (...args: unknown[]) => getAuthFromCookies(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))

import {
  SUPPORTED_LOCALES_CONFIG_MODULE,
  SUPPORTED_LOCALES_CONFIG_NAME,
  resolveTenantSupportedLocales,
} from '../supported-locales'

describe('resolveTenantSupportedLocales', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromCookies.mockResolvedValue({ tenantId: 'tenant-1' })
    createRequestContainer.mockResolvedValue({ resolve: () => ({ getValue }) })
    getValue.mockResolvedValue(null)
  })

  it('reads the tenant selection scoped to the signed-in tenant', async () => {
    getValue.mockResolvedValue(['en', 'de'])

    await expect(resolveTenantSupportedLocales()).resolves.toEqual(['en', 'de'])
    expect(getValue).toHaveBeenCalledWith(
      SUPPORTED_LOCALES_CONFIG_MODULE,
      SUPPORTED_LOCALES_CONFIG_NAME,
      { defaultValue: null, scope: { tenantId: 'tenant-1' } },
    )
  })

  describe('returns null — "no opinion", leave the served set alone', () => {
    it('for an anonymous request', async () => {
      getAuthFromCookies.mockResolvedValue(null)

      await expect(resolveTenantSupportedLocales()).resolves.toBeNull()
      // No tenant means no reason to pay for a request container in the root
      // layout, which every anonymous page render goes through.
      expect(createRequestContainer).not.toHaveBeenCalled()
    })

    it('for a session with no tenant', async () => {
      getAuthFromCookies.mockResolvedValue({ sub: 'user-1' })

      await expect(resolveTenantSupportedLocales()).resolves.toBeNull()
      expect(createRequestContainer).not.toHaveBeenCalled()
    })

    it('when the tenant has never saved a selection', async () => {
      getValue.mockResolvedValue(null)

      await expect(resolveTenantSupportedLocales()).resolves.toBeNull()
    })

    it('when the stored value is not an array', async () => {
      getValue.mockResolvedValue('en,de')

      await expect(resolveTenantSupportedLocales()).resolves.toBeNull()
    })

    it('when the stored array is empty', async () => {
      getValue.mockResolvedValue([])

      await expect(resolveTenantSupportedLocales()).resolves.toBeNull()
    })

    it('when every entry is filtered out as unusable', async () => {
      getValue.mockResolvedValue(['', null, 42, {}])

      await expect(resolveTenantSupportedLocales()).resolves.toBeNull()
    })
  })

  it('keeps the usable entries and drops the rest', async () => {
    getValue.mockResolvedValue(['en', '', null, 'de', 7])

    await expect(resolveTenantSupportedLocales()).resolves.toEqual(['en', 'de'])
  })

  describe('never throws — it runs in the root layout', () => {
    it('swallows an auth failure', async () => {
      getAuthFromCookies.mockRejectedValue(new Error('no request context'))

      await expect(resolveTenantSupportedLocales()).resolves.toBeNull()
    })

    it('swallows a container that cannot be built yet during boot', async () => {
      createRequestContainer.mockRejectedValue(new Error('orm not initialized'))

      await expect(resolveTenantSupportedLocales()).resolves.toBeNull()
    })

    it('swallows a database that is briefly unavailable', async () => {
      getValue.mockRejectedValue(new Error('connection refused'))

      await expect(resolveTenantSupportedLocales()).resolves.toBeNull()
    })

    it('swallows a missing moduleConfigService registration', async () => {
      createRequestContainer.mockResolvedValue({
        resolve: () => {
          throw new Error('could not resolve moduleConfigService')
        },
      })

      await expect(resolveTenantSupportedLocales()).resolves.toBeNull()
    })
  })
})
