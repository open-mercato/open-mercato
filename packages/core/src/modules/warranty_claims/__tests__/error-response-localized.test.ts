/** @jest-environment node */
import { randomUUID } from 'node:crypto'

// The translator resolves each key to its fallback sentence, so a raw i18n key
// that leaks straight into the response body (the #5512 defect) is trivially
// distinguishable from a genuinely localized message.
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const getAuthMock = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthMock(...args),
}))

const containerStub = { resolve: jest.fn() }
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => containerStub,
}))

const resolveOrganizationScopeForRequestMock = jest.fn()
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveOrganizationScopeForRequestMock(...args),
}))

const resolveAssigneeDisplayNamesMock = jest.fn()
jest.mock('../lib/assigneeNames', () => ({
  resolveAssigneeDisplayNames: (...args: unknown[]) => resolveAssigneeDisplayNamesMock(...args),
}))

const getCustomerAuthMock = jest.fn()
jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (...args: unknown[]) => getCustomerAuthMock(...args),
}))

import { GET as assigneesGET } from '../api/assignees/route'
import { GET as portalClaimsGET } from '../api/portal/claims/route'

const RAW_I18N_KEY = /^warranty_claims\./

async function readError(res: Response): Promise<{ status: number; body: Record<string, unknown>; error: string }> {
  const body = (await res.json()) as Record<string, unknown>
  return { status: res.status, body, error: String(body.error) }
}

describe('warranty_claims error responses are localized, never raw i18n keys (#5512)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthMock.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      tenantId: 'tenant-1',
      selectedId: 'org-1',
      filterIds: ['org-1'],
      allowedIds: ['org-1'],
    })
    resolveAssigneeDisplayNamesMock.mockResolvedValue(new Map())
    getCustomerAuthMock.mockResolvedValue(null)
  })

  describe('GET /api/warranty_claims/assignees', () => {
    it('returns a localized 400 when the required ids param is missing', async () => {
      const { status, error } = await readError(
        await assigneesGET(new Request('http://localhost/api/warranty_claims/assignees')),
      )
      expect(status).toBe(400)
      expect(error).not.toMatch(RAW_I18N_KEY)
      expect(error).toBe('Invalid input')
    })

    it('returns a localized 400 when ids is present but empty', async () => {
      const { status, error } = await readError(
        await assigneesGET(new Request('http://localhost/api/warranty_claims/assignees?ids=')),
      )
      expect(status).toBe(400)
      expect(error).not.toMatch(RAW_I18N_KEY)
    })

    it('returns a localized 401 when the caller is unauthenticated', async () => {
      getAuthMock.mockResolvedValue(null)
      const { status, error } = await readError(
        await assigneesGET(new Request(`http://localhost/api/warranty_claims/assignees?ids=${randomUUID()}`)),
      )
      expect(status).toBe(401)
      expect(error).not.toMatch(RAW_I18N_KEY)
    })

    it('returns a localized 500 when the assignee lookup helper fails', async () => {
      resolveAssigneeDisplayNamesMock.mockRejectedValue(new Error('boom'))
      const { status, error } = await readError(
        await assigneesGET(new Request(`http://localhost/api/warranty_claims/assignees?ids=${randomUUID()}`)),
      )
      expect(status).toBe(500)
      expect(error).not.toMatch(RAW_I18N_KEY)
    })
  })

  describe('GET /api/warranty_claims/portal/claims', () => {
    it('returns a localized 401 when there is no portal session', async () => {
      const { status, body, error } = await readError(
        await portalClaimsGET(new Request('http://localhost/api/warranty_claims/portal/claims')),
      )
      expect(status).toBe(401)
      expect(body.ok).toBe(false)
      expect(error).not.toMatch(RAW_I18N_KEY)
    })

    it('returns a localized 403 when the account is not linked to a customer record', async () => {
      getCustomerAuthMock.mockResolvedValue({
        sub: 'customer-1',
        sid: 'session-1',
        tenantId: 'tenant-1',
        orgId: 'org-1',
        email: 'buyer@example.com',
        customerEntityId: null,
        personEntityId: null,
      })
      const { status, body, error } = await readError(
        await portalClaimsGET(new Request('http://localhost/api/warranty_claims/portal/claims')),
      )
      expect(status).toBe(403)
      expect(body.ok).toBe(false)
      expect(error).not.toMatch(RAW_I18N_KEY)
    })
  })
})
