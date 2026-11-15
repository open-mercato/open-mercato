import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { handleScimApiError, handleSsoAdminApiError } from '../error-handler'

describe('SSO authority error responses', () => {
  it('returns a canonical authorization failure to config clients as 403', async () => {
    const response = handleSsoAdminApiError(forbidden('Authorization denied'), 'Config test')
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Authorization denied' })
  })

  it('retains the SCIM error resource for canonical authorization failures', async () => {
    const response = handleScimApiError(forbidden('Authorization denied'), 'SCIM test')
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '403', detail: 'Authorization denied',
    })
  })
})
