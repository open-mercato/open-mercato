import React from 'react'

jest.mock('@/.mercato/generated/backend-route-metadata.generated', () => ({
  backendRouteMetadata: [],
}))

jest.mock('@open-mercato/shared/modules/registry', () => ({
  findRouteManifestMatch: jest.fn(() => undefined),
}))

const cookieStore = { get: jest.fn(() => undefined) }
const headerStore = { get: jest.fn(() => '/backend') }

jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => cookieStore),
  headers: jest.fn(async () => headerStore),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: jest.fn(async () => ({ sub: 'user-1', tenantId: 'tenant-1', features: [] })),
}))

jest.mock('@open-mercato/ui/backend/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}))

const resolveSupportedLocalesForRequest = jest.fn(async () => ['en', 'pl', 'de'])
const resolveTranslations = jest.fn(async () => ({
  translate: (_key: string, fallback?: string) => fallback ?? '',
  locale: 'pl',
  dict: {},
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveSupportedLocalesForRequest: (...args: unknown[]) => resolveSupportedLocalesForRequest(...args),
  resolveTranslations: (...args: unknown[]) => resolveTranslations(...(args as [])),
}))

jest.mock('@open-mercato/shared/lib/i18n/locale', () => ({
  resolveForcedLocale: jest.fn(() => null),
}))

const I18nProvider = ({ children }: { children: React.ReactNode }) =>
  React.createElement(React.Fragment, null, children)

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  I18nProvider: (props: { children: React.ReactNode }) => I18nProvider(props),
}))

jest.mock('@open-mercato/core/modules/auth/lib/profile-sections', () => ({
  profilePathPrefixes: [],
}))

jest.mock('@open-mercato/shared/lib/version', () => ({ APP_VERSION: 'test' }))

jest.mock('@open-mercato/shared/lib/boolean', () => ({
  parseBooleanToken: jest.fn(() => null),
  parseBooleanWithDefault: jest.fn(() => false),
}))

jest.mock('@open-mercato/ui/backend/injection/PageInjectionBoundary', () => ({
  PageInjectionBoundary: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}))

const backendDateLocaleSettings = { locale: 'pl-PL', timeZone: 'Europe/Warsaw' }
const resolveDateLocaleSettingsForRequest = jest.fn(async () => backendDateLocaleSettings)

jest.mock('@open-mercato/shared/lib/date-locale/registry', () => ({
  resolveDateLocaleSettingsForRequest: () => resolveDateLocaleSettingsForRequest(),
}))

const DateLocaleSettingsProvider = ({ children }: { children: React.ReactNode }) =>
  React.createElement(React.Fragment, null, children)

jest.mock('@open-mercato/ui/primitives/date-locale-settings', () => ({
  DateLocaleSettingsProvider: (props: { children: React.ReactNode }) => DateLocaleSettingsProvider(props),
}))

jest.mock('@/components/DemoFeedbackWidget', () => ({ DemoFeedbackWidget: () => null }))
jest.mock('@/components/OrganizationSwitcher', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/BackendHeaderChrome', () => ({ BackendHeaderChrome: () => null }))

/**
 * The backend layout mounts a second `I18nProvider` inside the root layout's, and
 * an inner provider wins for the whole admin subtree. Before this was wired, the
 * tenant's locale selection was resolved by the root layout and then thrown away
 * here, so the profile language menu offered every shipped locale regardless.
 */
describe('Backend layout served locale set', () => {
  beforeEach(() => {
    resolveSupportedLocalesForRequest.mockClear()
    resolveTranslations.mockClear()
  })

  it('resolves the served set and detects the locale against it', async () => {
    const layout = await import('../layout')
    await layout.default({ children: null, params: Promise.resolve({}) })

    expect(resolveSupportedLocalesForRequest).toHaveBeenCalledTimes(1)
    expect(resolveTranslations).toHaveBeenCalledWith({ supportedLocales: ['en', 'pl', 'de'] })
  })

  it('hands the served set to its own provider instead of letting it fall back', async () => {
    const layout = await import('../layout')
    const tree = await layout.default({ children: null, params: Promise.resolve({}) })

    expect(tree.props).toMatchObject({
      locale: 'pl',
      supportedLocales: ['en', 'pl', 'de'],
      localeLocked: false,
    })
  })

  it('mounts its own date/locale settings provider so a login redirect picks up the signed-in settings', async () => {
    resolveDateLocaleSettingsForRequest.mockClear()
    const layout = await import('../layout')
    const tree = await layout.default({ children: null, params: Promise.resolve({}) })

    expect(resolveDateLocaleSettingsForRequest).toHaveBeenCalledTimes(1)
    const nested = tree.props.children
    expect(nested.props.value).toBe(backendDateLocaleSettings)
  })
})
