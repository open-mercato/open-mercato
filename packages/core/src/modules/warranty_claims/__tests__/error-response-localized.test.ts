/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// The translator resolves each key to its fallback sentence, so a raw i18n key
// that leaks straight into the response body (the #5512 defect) is trivially
// distinguishable from a genuinely localized message.
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
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

const runRouteMutationGuardsMock = jest.fn()
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))

const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/find'),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

import { GET as assigneesGET } from '../api/assignees/route'
import { GET as portalClaimsGET, POST as portalClaimsPOST } from '../api/portal/claims/route'
import {
  DELETE as portalAttachmentsDELETE,
  GET as portalAttachmentsGET,
  POST as portalAttachmentsPOST,
} from '../api/portal/attachments/route'
import { GET as portalEventsGET, POST as portalEventsPOST } from '../api/portal/events/route'
import { GET as portalClaimDetailGET } from '../api/portal/claims/[id]/route'
import { POST as portalClaimSubmitPOST } from '../api/portal/claims/[id]/submit/route'
import { POST as portalClaimWithdrawPOST } from '../api/portal/claims/[id]/withdraw/route'
import { POST as receivingPOST } from '../api/receiving/route'
import { POST as creditMemoPOST } from '../api/credit-memo/route'
import { POST as salesReturnPOST } from '../api/sales-return/route'
import { POST as replacementOrderPOST } from '../api/replacement-order/route'
import { POST as returnLabelPOST } from '../api/return-label/route'
import { POST as aiAssessPOST } from '../api/ai/assess/route'
import { GET as claimEventsGET } from '../api/events/route'
import { GET as riskGET } from '../api/risk/route'
import { GET as vendorRecoverySuggestionsGET } from '../api/vendor-recovery-suggestions/route'

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
    containerStub.resolve.mockImplementation((token: string) => (token === 'em' ? { fork: () => ({}) } : undefined))
    runRouteMutationGuardsMock.mockResolvedValue({ ok: true, modifiedPayload: null, runAfterSuccess: jest.fn() })
    findOneWithDecryptionMock.mockResolvedValue(null)
    findWithDecryptionMock.mockResolvedValue([])
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

  describe('portal claim attachments, events and detail routes (#5522)', () => {
    const claimRouteContext = (id: string) => ({ params: Promise.resolve({ id }) })

    it('returns a localized 401 on the attachments route when there is no portal session', async () => {
      const { status, body, error } = await readError(
        await portalAttachmentsGET(new Request('http://localhost/api/warranty_claims/portal/attachments')),
      )
      expect(status).toBe(401)
      expect(body.ok).toBe(false)
      expect(error).toBe('Unauthorized')
    })

    it('returns a localized 403 on the attachments route when the account is not linked', async () => {
      getCustomerAuthMock.mockResolvedValue({ ...LINKED_PORTAL_AUTH, customerEntityId: null })
      const { status, error } = await readError(
        await portalAttachmentsGET(new Request('http://localhost/api/warranty_claims/portal/attachments')),
      )
      expect(status).toBe(403)
      expect(error).not.toMatch(RAW_I18N_KEY)
    })

    it('returns a localized 400 when the attachment id is not a uuid', async () => {
      getCustomerAuthMock.mockResolvedValue(LINKED_PORTAL_AUTH)
      const { status, error } = await readError(
        await portalAttachmentsGET(
          new Request('http://localhost/api/warranty_claims/portal/attachments?attachmentId=nope'),
        ),
      )
      expect(status).toBe(400)
      expect(error).toBe('Invalid input')
    })

    it('returns a localized 400 when the attachment list query is invalid', async () => {
      getCustomerAuthMock.mockResolvedValue(LINKED_PORTAL_AUTH)
      const { status, error } = await readError(
        await portalAttachmentsGET(new Request('http://localhost/api/warranty_claims/portal/attachments')),
      )
      expect(status).toBe(400)
      expect(error).not.toMatch(RAW_I18N_KEY)
    })

    it('returns a localized 400 when an upload is not multipart', async () => {
      getCustomerAuthMock.mockResolvedValue(LINKED_PORTAL_AUTH)
      const { status, error } = await readError(
        await portalAttachmentsPOST(new Request('http://localhost/api/warranty_claims/portal/attachments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })),
      )
      expect(status).toBe(400)
      expect(error).toBe('Invalid input')
    })

    it('returns a localized 400 when a delete carries no attachment id', async () => {
      getCustomerAuthMock.mockResolvedValue(LINKED_PORTAL_AUTH)
      const { status, error } = await readError(
        await portalAttachmentsDELETE(new Request('http://localhost/api/warranty_claims/portal/attachments', {
          method: 'DELETE',
        })),
      )
      expect(status).toBe(400)
      expect(error).not.toMatch(RAW_I18N_KEY)
    })

    it('returns a localized 401 on the portal events route without a session', async () => {
      const { status, error } = await readError(
        await portalEventsGET(new Request('http://localhost/api/warranty_claims/portal/events')),
      )
      expect(status).toBe(401)
      expect(error).toBe('Unauthorized')
    })

    it('returns a localized 400 when the events query has no claim id', async () => {
      getCustomerAuthMock.mockResolvedValue(LINKED_PORTAL_AUTH)
      const { status, error } = await readError(
        await portalEventsGET(new Request('http://localhost/api/warranty_claims/portal/events')),
      )
      expect(status).toBe(400)
      expect(error).toBe('Invalid input')
    })

    it('returns a localized 400 when a portal comment body is not valid JSON', async () => {
      getCustomerAuthMock.mockResolvedValue(LINKED_PORTAL_AUTH)
      const { status, error } = await readError(
        await portalEventsPOST(new Request('http://localhost/api/warranty_claims/portal/events', {
          method: 'POST',
          body: '{not-json',
        })),
      )
      expect(status).toBe(400)
      expect(error).not.toMatch(RAW_I18N_KEY)
    })

    it('returns a localized 404 on the claim detail route when the id is blank', async () => {
      getCustomerAuthMock.mockResolvedValue(LINKED_PORTAL_AUTH)
      const { status, error } = await readError(
        await portalClaimDetailGET(
          new Request('http://localhost/api/warranty_claims/portal/claims/'),
          claimRouteContext(''),
        ),
      )
      expect(status).toBe(404)
      expect(error).toBe('Claim not found.')
    })

    it('returns a localized 404 on submit when the claim id is not a uuid', async () => {
      getCustomerAuthMock.mockResolvedValue(LINKED_PORTAL_AUTH)
      const { status, error } = await readError(
        await portalClaimSubmitPOST(
          new Request('http://localhost/api/warranty_claims/portal/claims/nope/submit', { method: 'POST' }),
          claimRouteContext('nope'),
        ),
      )
      expect(status).toBe(404)
      expect(error).toBe('Claim not found.')
    })

    it('returns a localized 404 on withdraw when the claim id is not a uuid', async () => {
      getCustomerAuthMock.mockResolvedValue(LINKED_PORTAL_AUTH)
      const { status, error } = await readError(
        await portalClaimWithdrawPOST(
          new Request('http://localhost/api/warranty_claims/portal/claims/nope/withdraw', { method: 'POST' }),
          claimRouteContext('nope'),
        ),
      )
      expect(status).toBe(404)
      expect(error).not.toMatch(RAW_I18N_KEY)
    })
  })

  describe('staff claim action routes (#5522)', () => {
    const actionRoutes: Array<[string, (req: Request) => Promise<Response>]> = [
      ['receiving', receivingPOST],
      ['credit-memo', creditMemoPOST],
      ['sales-return', salesReturnPOST],
      ['replacement-order', replacementOrderPOST],
      ['return-label', returnLabelPOST],
      ['ai/assess', aiAssessPOST],
    ]

    function actionRequest(path: string, body: unknown): Request {
      return new Request(`http://localhost/api/warranty_claims/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    it.each(actionRoutes)('returns a localized 401 from %s when the caller is unauthenticated', async (path, handler) => {
      getAuthMock.mockResolvedValue(null)
      const { status, error } = await readError(await handler(actionRequest(path, {})))
      expect(status).toBe(401)
      expect(error).toBe('Unauthorized')
    })

    it.each(actionRoutes)('returns a localized 400 from %s when no organization can be resolved', async (path, handler) => {
      getAuthMock.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: null })
      resolveOrganizationScopeForRequestMock.mockResolvedValue(null)
      const { status, error } = await readError(await handler(actionRequest(path, {})))
      expect(status).toBe(400)
      expect(error).toBe('Organization context is required.')
    })

    it.each(actionRoutes)('returns a localized 400 from %s when the body fails validation', async (path, handler) => {
      const { status, error } = await readError(await handler(actionRequest(path, {})))
      expect(status).toBe(400)
      expect(error).not.toMatch(RAW_I18N_KEY)
    })

    it('returns a localized 404 from return-label when the claim is outside the caller scope', async () => {
      const { status, error } = await readError(
        await returnLabelPOST(actionRequest('return-label', { claimId: randomUUID() })),
      )
      expect(status).toBe(404)
      expect(error).toBe('Claim not found.')
    })

    it('returns a localized 404 from ai/assess when the claim is outside the caller scope', async () => {
      const tenantId = randomUUID()
      const organizationId = randomUUID()
      getAuthMock.mockResolvedValue({ sub: 'user-1', tenantId, orgId: organizationId })
      resolveOrganizationScopeForRequestMock.mockResolvedValue({
        tenantId,
        selectedId: organizationId,
        filterIds: [organizationId],
        allowedIds: [organizationId],
      })
      const { status, error } = await readError(
        await aiAssessPOST(actionRequest('ai/assess', {
          claimId: randomUUID(),
          attachmentId: randomUUID(),
          kind: 'proof',
        })),
      )
      expect(status).toBe(404)
      expect(error).toBe('Claim not found.')
    })

    it('translates the keyed zod message the return-label route surfaces (#5287)', async () => {
      const { status, error } = await readError(
        await returnLabelPOST(actionRequest('return-label', {
          claimId: '11111111-1111-4111-8111-111111111111',
          labelUrl: 'not-a-url',
        })),
      )
      expect(status).toBe(400)
      expect(error).not.toMatch(RAW_I18N_KEY)
    })
  })

  describe('claim-scoped read routes (#5522)', () => {
    const readRoutes: Array<[string, (req: Request) => Promise<Response>]> = [
      ['events', claimEventsGET],
      ['risk', riskGET],
      ['vendor-recovery-suggestions', vendorRecoverySuggestionsGET],
    ]

    it.each(readRoutes)('returns a localized 404 from %s when the claim is outside the caller scope', async (path, handler) => {
      const { status, error } = await readError(
        await handler(new Request(`http://localhost/api/warranty_claims/${path}?claimId=${randomUUID()}`)),
      )
      expect(status).toBe(404)
      expect(error).toBe('Claim not found.')
    })
  })
})


describe('no warranty_claims API route file inlines a raw i18n key in an error payload (#5522)', () => {
  const apiDir = join(__dirname, '..', 'api')

  function routeSources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return routeSources(full)
      return entry.isFile() && entry.name.endsWith('.ts') ? [full] : []
    })
  }

  it('keeps every error payload behind translate()', () => {
    const files = routeSources(apiDir)
    expect(files.length).toBeGreaterThan(20)
    const offenders = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /error: 'warranty_claims\./.test(line))
        .map(({ index }) => `${file.slice(apiDir.length + 1)}:${index + 1}`),
    )
    expect(offenders).toEqual([])
  })
})
