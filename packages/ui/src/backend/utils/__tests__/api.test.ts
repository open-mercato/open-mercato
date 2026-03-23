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
} from '../../utils/api'

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
    ;(window as unknown as Record<string, unknown>).__omOriginalFetch = undefined
  })

  afterEach(() => {
    ;(window as unknown as Record<string, unknown>).__omOriginalFetch = undefined
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('throws ForbiddenError when backend returns ACL hints', async () => {
    ;(window as unknown as Record<string, unknown>).__omOriginalFetch = jest.fn(async () =>
      createMockResponse(403, {
        error: 'Forbidden',
        requiredRoles: ['Admin'],
      }),
    )

    await expect(apiFetch('/api/private')).rejects.toBeInstanceOf(ForbiddenError)
    expect(flash).toHaveBeenCalledWith(
      'Insufficient permissions. Redirecting to login…',
      'warning',
    )
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
})
