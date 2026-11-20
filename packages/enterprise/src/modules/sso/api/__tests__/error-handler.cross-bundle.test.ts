import { handleSsoAdminApiError } from '../error-handler'
import { SsoConfigError } from '../../services/ssoConfigService'

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => null }))

function foreignBrandedError(brand: string, message: string, statusCode: number): Error {
  return Object.assign(new Error(message), {
    [Symbol.for(`@open-mercato/sso/${brand}`)]: true,
    statusCode,
  })
}

function foreignNamedError(name: string, message: string, statusCode: number): Error {
  const error = Object.assign(new Error(message), { statusCode })
  error.name = name
  return error
}

describe('SSO admin typed errors thrown by another bundled module copy', () => {
  it.each([
    ['second config for the organization', 'An SSO configuration already exists for this organization', 409],
    ['JIT enabled while SCIM tokens exist', 'Cannot enable JIT provisioning while SCIM directory sync is active. Revoke all SCIM tokens first.', 409],
    ['activation discovery failure', 'Cannot activate — discovery failed: getaddrinfo ENOTFOUND', 400],
    ['missing or deleted config', 'SSO configuration not found', 404],
  ])('maps a branded SsoConfigError for %s to its status', async (_case, message, statusCode) => {
    const error = foreignBrandedError('SsoConfigError', message, statusCode)
    expect(error).not.toBeInstanceOf(SsoConfigError)
    const response = handleSsoAdminApiError(error, 'SSO config test')
    expect(response.status).toBe(statusCode)
    await expect(response.json()).resolves.toEqual({ error: message })
  })

  it('maps an unbranded SsoConfigError copy by name and status', async () => {
    const response = handleSsoAdminApiError(foreignNamedError('SsoConfigError', 'SSO configuration not found', 404), 'SSO config test')
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'SSO configuration not found' })
  })

  it.each([
    ['ScimTokenError', 'Cannot create SCIM tokens while JIT provisioning is enabled. Disable JIT first.', 409],
    ['ScimTokenError', 'SCIM token not found', 404],
    ['SsoAdminAuthError', 'Unauthorized', 401],
  ])('maps a foreign %s copy to its status', async (name, message, statusCode) => {
    for (const error of [foreignBrandedError(name, message, statusCode), foreignNamedError(name, message, statusCode)]) {
      const response = handleSsoAdminApiError(error, 'SSO admin test')
      expect(response.status).toBe(statusCode)
      await expect(response.json()).resolves.toEqual({ error: message })
    }
  })

  it('still hides unknown errors and look-alikes without a valid HTTP status behind a 500', async () => {
    const lookAlike = foreignNamedError('SsoConfigError', 'leaky detail', 0)
    const unknown = new Error('database exploded')
    for (const error of [lookAlike, unknown]) {
      const response = handleSsoAdminApiError(error, 'SSO admin test')
      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({ error: 'Internal server error' })
    }
  })
})
