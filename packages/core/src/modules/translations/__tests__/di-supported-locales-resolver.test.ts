const registerSupportedLocalesResolver = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/locale-registry', () => ({
  registerSupportedLocalesResolver: (...args: unknown[]) => registerSupportedLocalesResolver(...args),
}))

jest.mock('@open-mercato/shared/lib/localization/translatable-fields', () => ({
  registerTranslatableFields: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/localization/overlay-plugin', () => ({
  registerTranslationOverlayPlugin: jest.fn(),
}))

jest.mock('../lib/supported-locales', () => ({
  resolveTenantSupportedLocales: jest.fn(async () => null),
}))

/**
 * Module DI registrars only run when the first request container is built, but
 * the root layout resolves the served locale set without ever building one — so
 * a resolver registered inside `register()` misses the first render of a fresh
 * process and the tenant's selection is silently ignored (UX finding 4).
 */
describe('translations DI: supported-locales resolver registration', () => {
  beforeEach(() => {
    jest.resetModules()
    registerSupportedLocalesResolver.mockClear()
  })

  it('registers the tenant resolver at import time, not on the first container build', async () => {
    const { resolveTenantSupportedLocales } = await import('../lib/supported-locales')
    await import('../di')

    expect(registerSupportedLocalesResolver).toHaveBeenCalledTimes(1)
    expect(registerSupportedLocalesResolver).toHaveBeenCalledWith(resolveTenantSupportedLocales)
  })

  it('does not register it a second time when the DI registrar runs', async () => {
    const di = await import('../di')
    registerSupportedLocalesResolver.mockClear()

    di.register({ register: jest.fn() } as never)

    // A second call would trip the registry's "replacing an already-registered
    // resolver" warning on every request container.
    expect(registerSupportedLocalesResolver).not.toHaveBeenCalled()
  })
})
