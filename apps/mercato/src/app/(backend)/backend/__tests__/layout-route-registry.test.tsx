import React from 'react'

const backendRoutes = [
  {
    moduleId: 'auth',
    pattern: '/backend/auth/users',
    pageContext: 'settings' as const,
  },
]

const mockRegisterBackendRouteManifests = jest.fn()

jest.mock('@/.mercato/generated/backend-routes.generated', () => ({
  backendRoutes,
}))

jest.mock('@open-mercato/shared/modules/registry', () => ({
  findRouteManifestMatch: jest.fn(() => undefined),
  registerBackendRouteManifests: (...args: unknown[]) => mockRegisterBackendRouteManifests(...args),
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
  headers: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(),
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
  parseBooleanWithDefault: jest.fn(() => true),
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
  })

  it('registers backend route manifests at module load', async () => {
    await jest.isolateModulesAsync(async () => {
      await import('../layout')
    })

    expect(mockRegisterBackendRouteManifests).toHaveBeenCalledWith(backendRoutes)
  })
})
