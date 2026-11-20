import { SsoConfigError } from '../../../../../services/ssoConfigService'
import { POST } from '../route'

const mockActivate = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => ({ activate: mockActivate }) }),
}))
jest.mock('../../../../admin-context', () => ({
  resolveSsoAdminContext: async () => ({ scope: { tenantId: 'tenant', organizationId: 'org', isSuperAdmin: false } }),
  SsoAdminAuthError: class extends Error {},
}))
jest.mock('../../../../../services/scimTokenService', () => ({ ScimTokenError: class extends Error {} }))
jest.mock('../../../../../services/scimService', () => ({ ScimServiceError: class extends Error {} }))
jest.mock('@open-mercato/shared/lib/logger', () => ({ createLogger: () => ({ error: jest.fn(), child: jest.fn() }) }))

function activateRequest() {
  return new Request('http://localhost/api/sso/config/config-id/activate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ active: true }),
  })
}

describe('SSO activation error boundary', () => {
  beforeEach(() => jest.clearAllMocks())

  it.each([400, 404, 409])('preserves a config error from a duplicated module (%s)', async (statusCode) => {
    let duplicatedError: Error | undefined
    jest.isolateModules(() => {
      const duplicatedModule: typeof import('../../../../../services/ssoConfigService') = require('../../../../../services/ssoConfigService')
      duplicatedError = new duplicatedModule.SsoConfigError('Cannot activate: issuer blocked', statusCode)
    })
    expect(duplicatedError).not.toBeInstanceOf(SsoConfigError)
    mockActivate.mockRejectedValue(duplicatedError)

    const response = await POST(activateRequest(), { params: Promise.resolve({ id: 'config-id' }) })

    expect(response.status).toBe(statusCode)
    await expect(response.json()).resolves.toEqual({ error: 'Cannot activate: issuer blocked' })
    expect(mockActivate).toHaveBeenCalledWith(
      { tenantId: 'tenant', organizationId: 'org', isSuperAdmin: false }, 'config-id', true,
    )
  })

  it.each([
    new Error('secret failure'),
    { name: 'SsoConfigError', message: 'secret failure', statusCode: 400 },
    { [Symbol.for('@open-mercato/sso/SsoConfigError')]: true, message: 'secret failure', statusCode: 200 },
    { [Symbol.for('@open-mercato/sso/SsoConfigError')]: true, message: 'secret failure', statusCode: 400.5 },
    { [Symbol.for('@open-mercato/sso/SsoConfigError')]: true, message: 123, statusCode: 400 },
  ])('redacts unknown or malformed errors: %p', async (error) => {
    mockActivate.mockRejectedValue(error)
    const response = await POST(activateRequest(), { params: Promise.resolve({ id: 'config-id' }) })
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' })
  })
})
