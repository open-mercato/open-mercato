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
import { GET as portalClaimsGET, POST as portalClaimsPOST } from '../api/portal/claims/route'

const RAW_I18N_KEY = /^warranty_claims\./

const LINKED_PORTAL_AUTH = {
  sub: 'customer-1',
  sid: 'session-1',
  tenantId: 'tenant-1',
  orgId: 'org-1',
  email: 'buyer@example.com',
  customerEntityId: 'customer-entity-1',
  personEntityId: null,
  displayName: 'Buyer One',
}

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

    it('returns a localized 400 when the list query is invalid', async () => {
      getCustomerAuthMock.mockResolvedValue(LINKED_PORTAL_AUTH)
      const { status, body, error } = await readError(
        await portalClaimsGET(new Request('http://localhost/api/warranty_claims/portal/claims?page=0')),
      )
      expect(status).toBe(400)
      expect(body.ok).toBe(false)
      expect(error).not.toMatch(RAW_I18N_KEY)
    })

    it('returns a localized 400 when the POST body is not valid JSON', async () => {
      getCustomerAuthMock.mockResolvedValue(LINKED_PORTAL_AUTH)
      const { status, body, error } = await readError(
        await portalClaimsPOST(new Request('http://localhost/api/warranty_claims/portal/claims', {
          method: 'POST',
          body: '{not-json',
        })),
      )
      expect(status).toBe(400)
      expect(body.ok).toBe(false)
      expect(error).not.toMatch(RAW_I18N_KEY)
    })

    it('returns a localized 400 when the POST body fails intake validation', async () => {
      getCustomerAuthMock.mockResolvedValue(LINKED_PORTAL_AUTH)
      const { status, body, error } = await readError(
        await portalClaimsPOST(new Request('http://localhost/api/warranty_claims/portal/claims', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })),
      )
      expect(status).toBe(400)
      expect(body.ok).toBe(false)
      expect(error).not.toMatch(RAW_I18N_KEY)
    })
  })
})
