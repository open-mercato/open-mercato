import { handleSsoAdminApiError } from '../error-handler'
import { ScimTokenError } from '../../services/scimTokenService'

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn(), child: jest.fn().mockReturnThis() }),
}))
jest.mock('../admin-context', () => ({ SsoAdminAuthError: class extends Error {} }))
jest.mock('../../services/ssoConfigService', () => ({ SsoConfigError: class extends Error {} }))
jest.mock('../../services/scimService', () => ({ ScimServiceError: class extends Error {} }))

function errorFromSeparateModule(message: string, statusCode: number): Error {
  let error: Error | undefined
  jest.isolateModules(() => {
    const serviceModule = jest.requireActual<typeof import('../../services/scimTokenService')>('../../services/scimTokenService')
    error = new serviceModule.ScimTokenError(message, statusCode)
  })
  if (!error) throw new Error('[internal] Separate module did not create the test error')
  return error
}

describe('SSO admin error boundary', () => {
  it('preserves the scoped token-not-found response across module copies', async () => {
    const error = errorFromSeparateModule('SCIM token not found', 404)
    expect(error).not.toBeInstanceOf(ScimTokenError)

    const response = handleSsoAdminApiError(error, 'SCIM Tokens API')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'SCIM token not found' })
  })

  it('preserves safe enrollment-unavailable errors across module copies', async () => {
    const error = errorFromSeparateModule('[internal] SCIM token enrollment unavailable', 503)

    const response = handleSsoAdminApiError(error, 'SCIM Tokens API')

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: '[internal] SCIM token enrollment unavailable' })
  })

  it('does not disclose an unbranded error that imitates a token error name', async () => {
    const error = Object.assign(new Error('[internal] Private diagnostic'), { name: 'ScimTokenError', statusCode: 404 })

    const response = handleSsoAdminApiError(error, 'SCIM Tokens API')

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' })
  })
})
