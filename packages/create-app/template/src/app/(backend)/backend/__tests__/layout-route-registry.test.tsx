import React from 'react'

const backendRoutes = [
  {
    moduleId: 'auth',
    pattern: '/backend/auth/users',
    pageContext: 'settings' as const,
  },
]

const mockRegisterBackendRouteManifests = jest.fn()
const mockParseBooleanWithDefault = jest.fn(() => false)
const mockCookies = jest.fn()
const mockHeaders = jest.fn()
const mockResolveTranslations = jest.fn()
const mockGetAuthFromCookies = jest.fn()

jest.mock('@/.mercato/generated/backend-routes.generated', () => ({
  backendRoutes,
}))

jest.mock('@open-mercato/shared/modules/registry', () => ({
  findRouteManifestMatch: jest.fn(() => undefined),
  registerBackendRouteManifests: (...args: unknown[]) => mockRegisterBackendRouteManifests(...args),
}))

jest.mock('next/headers', () => ({
  cookies: (...args: unknown[]) => mockCookies(...args),
  headers: (...args: unknown[]) => mockHeaders(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: (...args: unknown[]) => mockGetAuthFromCookies(...args),
}))

jest.mock('@open-mercato/ui/backend/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: (...args: unknown[]) => mockResolveTranslations(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}))

jest.mock('@open-mercato/core/modules/auth/lib/profile-sections', () => ({
  profilePathPrefixes: [],
}))

jest.mock('@open-mercato/shared/lib/version', () => ({
  APP_VERSION: 'test',
}))

jest.mock('@open-mercato/shared/lib/boolean', () => ({
  parseBooleanWithDefault: (...args: unknown[]) => mockParseBooleanWithDefault(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/PageInjectionBoundary', () => ({
  PageInjectionBoundary: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}))

jest.mock('@/components/DemoFeedbackWidget', () => ({
  DemoFeedbackWidget: () => null,
}))

jest.mock('@/components/OrganizationSwitcher', () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock('@/components/BackendHeaderChrome', () => ({
  BackendHeaderChrome: () => null,
}))

describe('Backend layout route registry', () => {
  beforeEach(() => {
    jest.resetModules()
    mockRegisterBackendRouteManifests.mockClear()
    mockParseBooleanWithDefault.mockClear()
    mockCookies.mockReset()
    mockHeaders.mockReset()
    mockResolveTranslations.mockReset()
    mockGetAuthFromCookies.mockReset()
  })

  it('registers backend route manifests at module load', async () => {
    await jest.isolateModulesAsync(async () => {
      await import('../layout')
    })

    expect(mockRegisterBackendRouteManifests).toHaveBeenCalledWith(backendRoutes)
  })

  it('defaults the demo mode flag to false when DEMO_MODE is unset', async () => {
    const originalDemoMode = process.env.DEMO_MODE
    delete process.env.DEMO_MODE
    mockGetAuthFromCookies.mockResolvedValue(null)
    mockCookies.mockResolvedValue({ get: () => undefined })
    mockHeaders.mockResolvedValue({ get: () => null })
    mockResolveTranslations.mockResolvedValue({
      translate: (_key: string, fallback: string) => fallback,
      locale: 'en',
      dict: {},
    })

    try {
      await jest.isolateModulesAsync(async () => {
        const { default: BackendLayout } = await import('../layout')
        await BackendLayout({
          children: React.createElement('div'),
          params: Promise.resolve({}),
        })
      })

      expect(mockParseBooleanWithDefault).toHaveBeenCalledWith(undefined, false)
    } finally {
      if (originalDemoMode === undefined) {
        delete process.env.DEMO_MODE
      } else {
        process.env.DEMO_MODE = originalDemoMode
      }
    }
  })
})
