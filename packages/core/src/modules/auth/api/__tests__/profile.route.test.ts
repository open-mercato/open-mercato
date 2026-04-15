/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockSignJwt = jest.fn()
const mockCommandExecute = jest.fn()
const mockGetUserRoles = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/jwt', () => ({
  signJwt: (...args: unknown[]) => mockSignJwt(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import { GET, PUT } from '@open-mercato/core/modules/auth/api/profile/route'

describe('auth profile route', () => {
  const container = {
    resolve: (token: string) => {
      switch (token) {
        case 'em':
          return {}
        case 'authService':
          return { getUserRoles: mockGetUserRoles }
        case 'commandBus':
          return { execute: mockCommandExecute }
        default:
          return null
      }
    },
  }

  beforeEach(() => {
    mockGetAuthFromRequest.mockReset()
    mockCreateRequestContainer.mockReset()
    mockFindOneWithDecryption.mockReset()
    mockSignJwt.mockReset()
    mockCommandExecute.mockReset()
    mockGetUserRoles.mockReset()

    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      roles: ['admin'],
    })
    mockCreateRequestContainer.mockResolvedValue(container)
    mockGetUserRoles.mockResolvedValue(['admin'])
    mockSignJwt.mockReturnValue('signed-jwt')
  })

  it('extends GET /api/auth/profile with accessibility preferences', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      accessibilityPreferences: {
        highContrast: true,
        fontSize: 'lg',
        reducedMotion: false,
      },
    })

    const response = await GET(new Request('http://localhost/api/auth/profile'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      email: 'user@example.com',
      roles: ['admin'],
      accessibilityPreferences: {
        highContrast: true,
        fontSize: 'lg',
        reducedMotion: false,
      },
    })
  })

  it('accepts accessibility preferences without changing the PUT response shape', async () => {
    mockCommandExecute.mockResolvedValue({
      result: {
        id: 'user-1',
        email: 'user@example.com',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        accessibilityPreferences: {
          highContrast: true,
          fontSize: 'md',
          reducedMotion: false,
        },
      },
    })

    const response = await PUT(new Request('http://localhost/api/auth/profile', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accessibilityPreferences: {
          highContrast: true,
        },
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      email: 'user@example.com',
    })
    expect(body).not.toHaveProperty('accessibilityPreferences')
    expect(mockCommandExecute).toHaveBeenCalledWith(
      'auth.users.update',
      expect.objectContaining({
        input: expect.objectContaining({
          id: 'user-1',
          accessibilityPreferences: {
            highContrast: true,
          },
        }),
      }),
    )
    expect(mockSignJwt).not.toHaveBeenCalled()
  })
})
