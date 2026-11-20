/**
 * @jest-environment jsdom
 */
jest.mock('../../FlashMessages', () => ({
  flash: jest.fn(),
}))

import { flash } from '../../FlashMessages'
import {
  ForbiddenError,
  UnauthorizedError,
  apiFetch,
  notifyForbiddenAccess,
  redirectToSessionRefresh,
  registerAuthNoticeTranslator,
} from '../../utils/api'
import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'

function createMockResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): Response {
  const serializedBody =
    typeof body === 'string' ? body : JSON.stringify(body ?? {})
  const headerMap = new Map<string, string>(
    Object.entries(headers ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  )
  const build = () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (key: string) => headerMap.get(key.toLowerCase()) ?? null,
      },
      json: async () => JSON.parse(serializedBody),
      text: async () => serializedBody,
      clone: () => build(),
    }) as Response
  return build()
}

describe('apiFetch', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.useFakeTimers()
    window.history.pushState({}, '', '/backend/sales/documents')
    window.sessionStorage.clear()
    ;(window as unknown as Record<string, unknown>).__omOriginalFetch = undefined
  })

  afterEach(() => {
    ;(window as unknown as Record<string, unknown>).__omOriginalFetch = undefined
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('throws ForbiddenError and flashes a non-redirecting banner when backend returns ACL hints', async () => {
    ;(window as unknown as Record<string, unknown>).__omOriginalFetch = jest.fn(async () =>
      createMockResponse(403, {
        error: 'Forbidden',
        requiredRoles: ['Admin'],
      }),
    )
    const initialPath = window.location.pathname

    await expect(apiFetch('/api/private')).rejects.toBeInstanceOf(ForbiddenError)
    expect(flash).toHaveBeenCalledWith(
      expect.stringContaining('Access denied'),
      'warning',
    )
    expect(flash).toHaveBeenCalledWith(
      expect.stringContaining('Admin'),
      'warning',
    )

    // Regression for GH #2070: authenticated 403 must not redirect to /login.
    jest.advanceTimersByTime(1000)
    expect(window.location.pathname).toBe(initialPath)
    expect(window.location.pathname).not.toContain('/login')
  })

  it('includes the missing feature name in the flash so the user sees the actual permission required', async () => {
    ;(window as unknown as Record<string, unknown>).__omOriginalFetch = jest.fn(async () =>
      createMockResponse(403, {
        error: 'Forbidden',
        requiredFeatures: ['sales.channels.manage'],
      }),
    )

    await expect(apiFetch('/api/sales/channels')).rejects.toBeInstanceOf(ForbiddenError)
    expect(flash).toHaveBeenCalledWith(
      expect.stringContaining('sales.channels.manage'),
      'warning',
    )
  })

  it('attaches requiredFeatures to ForbiddenError so callers can name the missing permission', async () => {
    ;(window as unknown as Record<string, unknown>).__omOriginalFetch = jest.fn(async () =>
      createMockResponse(403, {
        error: 'Forbidden',
        requiredFeatures: ['wms.manage_locations'],
      }),
    )

    const rejection = await apiFetch('/api/wms/locations').catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(ForbiddenError)
    expect((rejection as ForbiddenError).requiredFeatures).toEqual(['wms.manage_locations'])
    expect((rejection as ForbiddenError).status).toBe(403)
  })

  it('throws ForbiddenError when ACL hints are missing', async () => {
    const response = createMockResponse(403, {
      error: 'Forbidden',
      message: 'Access denied without ACL hints',
    })
    ;(window as unknown as Record<string, unknown>).__omOriginalFetch = jest.fn(async () => response)

    await expect(apiFetch('/api/private')).rejects.toBeInstanceOf(ForbiddenError)
    expect(flash).not.toHaveBeenCalled()
  })

  it('does not redirect on login page and returns 403 payload', async () => {
    window.history.pushState({}, '', '/login')
    const response = createMockResponse(403, {
      error: 'Forbidden',
      requiredRoles: ['Admin'],
    })
    ;(window as unknown as Record<string, unknown>).__omOriginalFetch = jest.fn(async () => response)

    const result = await apiFetch('/api/private')
    expect(result).toBe(response)
    expect(flash).not.toHaveBeenCalled()
  })

  it('returns 401 payload when unauthorized redirect is disabled', async () => {
    const response = createMockResponse(401, {
      error: 'checkout.payPage.errors.password',
    })
    ;(window as unknown as Record<string, unknown>).__omOriginalFetch = jest.fn(async () => response)

    const result = await apiFetch('/api/private', {
      headers: {
        'x-om-unauthorized-redirect': '0',
      },
    })

    expect(result).toBe(response)
    expect(flash).not.toHaveBeenCalled()
  })

  it('stays silent when a login-page 401 lands after the post-login navigation', async () => {
    window.history.pushState({}, '', '/login')
    ;(window as unknown as Record<string, unknown>).__omOriginalFetch = jest.fn(async () => {
      // The sign-in completes while the pre-auth probe is still in flight, so the
      // app has already client-navigated to /backend when the 401 arrives.
      window.history.pushState({}, '', '/backend')
      return createMockResponse(401, { error: 'Unauthorized' })
    })

    const result = await apiFetch('/api/auth/feature-check', { method: 'POST' })

    expect(result.status).toBe(401)
    expect(flash).not.toHaveBeenCalled()
  })

  it('stays silent when a 401 lands after navigating to the login page', async () => {
    ;(window as unknown as Record<string, unknown>).__omOriginalFetch = jest.fn(async () => {
      window.history.pushState({}, '', '/login')
      return createMockResponse(401, { error: 'Unauthorized' })
    })

    const result = await apiFetch('/api/private')

    expect(result.status).toBe(401)
    expect(flash).not.toHaveBeenCalled()
  })

  it('stays silent on a passive /start visit — a background auth-check 401 is expected, not a real session problem (GH #6159)', async () => {
    window.history.pushState({}, '', '/start')
    ;(window as unknown as Record<string, unknown>).__omOriginalFetch = jest.fn(async () =>
      createMockResponse(401, { error: 'Nieautoryzowany' }),
    )

    const result = await apiFetch('/api/auth/feature-check', { method: 'POST' })

    expect(result.status).toBe(401)
    expect(flash).not.toHaveBeenCalled()
  })

  it('stays silent when a 401 lands after navigating to /start', async () => {
    ;(window as unknown as Record<string, unknown>).__omOriginalFetch = jest.fn(async () => {
      window.history.pushState({}, '', '/start')
      return createMockResponse(401, { error: 'Unauthorized' })
    })

    const result = await apiFetch('/api/private')

    expect(result.status).toBe(401)
    expect(flash).not.toHaveBeenCalled()
  })

  it('throws UnauthorizedError for 401 responses by default', async () => {
    ;(window as unknown as Record<string, unknown>).__omOriginalFetch = jest.fn(async () =>
      createMockResponse(401, { error: 'Unauthorized' }),
    )

    await expect(apiFetch('/api/private')).rejects.toBeInstanceOf(UnauthorizedError)
    expect(flash).toHaveBeenCalledWith(
      'Session expired. Redirecting to sign in…',
      'warning',
    )
  })

  it('guards the session-refresh redirect from looping when a non-session 401 repeats on the same page (GH #5186)', async () => {
    ;(window as unknown as Record<string, unknown>).__omOriginalFetch = jest.fn(async () =>
      createMockResponse(401, { error: 'Unauthorized' }),
    )

    await expect(apiFetch('/api/private')).rejects.toBeInstanceOf(UnauthorizedError)
    expect(flash).toHaveBeenCalledTimes(1)

    // The refresh bounce lands back on the same page and the same endpoint
    // answers 401 again — the second attempt must not re-trigger the redirect.
    await expect(apiFetch('/api/private')).rejects.toBeInstanceOf(UnauthorizedError)
    expect(flash).toHaveBeenCalledTimes(1)
  })
})

describe('auth notice banners i18n (GH #7381)', () => {
  const polishTranslator = createTranslator({
    'ui.auth.sessionExpired': 'Sesja wygasła. Przekierowanie do logowania…',
    'ui.auth.accessDenied.missingFeatures': 'Odmowa dostępu: brakuje uprawnienia „{features}”.',
    'ui.auth.accessDenied.requiredRoles': 'Odmowa dostępu: wymagana rola „{roles}”.',
    'ui.auth.accessDenied.generic': 'Odmowa dostępu.',
  })
  let unregister: (() => void) | null = null

  beforeEach(() => {
    jest.resetAllMocks()
    jest.useFakeTimers()
    window.history.pushState({}, '', '/backend/customers/people')
    window.sessionStorage.clear()
  })

  afterEach(() => {
    unregister?.()
    unregister = null
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('translates the session-expired banner with the registered translator', () => {
    unregister = registerAuthNoticeTranslator(polishTranslator)

    redirectToSessionRefresh()

    expect(flash).toHaveBeenCalledWith('Sesja wygasła. Przekierowanie do logowania…', 'warning')
  })

  it('translates the access-denied banners and interpolates features and roles', () => {
    unregister = registerAuthNoticeTranslator(polishTranslator)

    notifyForbiddenAccess({ requiredFeatures: ['dashboards.view'] })
    notifyForbiddenAccess({ requiredRoles: ['admin'] })

    expect(flash).toHaveBeenNthCalledWith(1, 'Odmowa dostępu: brakuje uprawnienia „dashboards.view”.', 'warning')
    expect(flash).toHaveBeenNthCalledWith(2, 'Odmowa dostępu: wymagana rola „admin”.', 'warning')
  })

  it('falls back to English copy once the translator is unregistered', () => {
    registerAuthNoticeTranslator(polishTranslator)()

    notifyForbiddenAccess({ requiredFeatures: ['dashboards.view'] })

    expect(flash).toHaveBeenCalledWith(
      'Access denied: you are missing the required permission "dashboards.view". Contact your administrator.',
      'warning',
    )
  })

  it('keeps a newer translator when an older registration is cleaned up', () => {
    const releaseOlder = registerAuthNoticeTranslator(createTranslator({}))
    unregister = registerAuthNoticeTranslator(polishTranslator)
    releaseOlder()

    redirectToSessionRefresh()

    expect(flash).toHaveBeenCalledWith('Sesja wygasła. Przekierowanie do logowania…', 'warning')
  })
})
