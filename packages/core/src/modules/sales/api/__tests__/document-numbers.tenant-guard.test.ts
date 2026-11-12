/** @jest-environment node */
/**
 * Regression coverage for issue #7877 — a non-superadmin who pads a request body past the
 * central dispatcher's tenant-extraction byte budget could reach this handler carrying a
 * foreign `tenantId`, bypassing the dispatcher's own tenant-selection gate (the dispatcher
 * treats an oversized, unflagged-route body as "no candidate" rather than rejecting it).
 * This route reads `tenantId` from the body via `withScopedPayload` (re-exported from
 * `../utils`), not via `enforceTenantSelection` directly, so it has no self-enforcement of
 * its own — the fix lives in `withScopedPayload` itself
 * (`packages/shared/src/lib/api/scoped.ts`), which must now reject a foreign `tenantId`
 * regardless of how large the request body is or whether the dispatcher ever inspected it.
 */
import { POST } from '@open-mercato/core/modules/sales/api/document-numbers/route'

const ACTOR_TENANT_ID = '00000000-0000-4000-8000-00000000000a'
const FOREIGN_TENANT_ID = '00000000-0000-4000-8000-00000000000b'
const ORG_ID = '00000000-0000-4000-8000-0000000000aa'

const mockGenerate = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'salesDocumentNumberGenerator') return { generate: mockGenerate }
      if (token === 'rbacService') return { userHasAllFeatures: jest.fn(async () => true) }
      return null
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId: ACTOR_TENANT_ID, orgId: ORG_ID })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ filterIds: [ORG_ID] })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScopeFilter', () => ({
  resolveSingleOrganizationIdOrDeny: jest.fn(() => ORG_ID),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

function buildPaddedRequest(body: Record<string, unknown>): Request {
  // Simulates the request as it would reach this handler AFTER the dispatcher's own
  // tenant-extraction budget was exceeded and it let the request through unexamined — the
  // handler itself places no size limit on `req.json()`, so a 1MB padding field changes
  // nothing about what the handler reads.
  const padded = { ...body, padding: 'x'.repeat(1_000_000) }
  return new Request('https://app.example.com/api/sales/document-numbers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(padded),
  })
}

describe('document-numbers route tenant guard (issue #7877)', () => {
  beforeEach(() => {
    mockGenerate.mockReset()
    mockGenerate.mockResolvedValue({ number: 'SO-0001', format: 'SO-{seq}', sequence: 1 })
  })

  it('rejects an oversized body carrying a foreign tenantId instead of generating a number for it', async () => {
    const req = buildPaddedRequest({ kind: 'order', tenantId: FOREIGN_TENANT_ID, organizationId: ORG_ID })
    const res = await POST(req)
    expect(res.status).toBe(403)
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('still generates a number for the actor own tenant, oversized body notwithstanding', async () => {
    const req = buildPaddedRequest({ kind: 'order', tenantId: ACTOR_TENANT_ID, organizationId: ORG_ID })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ACTOR_TENANT_ID, organizationId: ORG_ID })
    )
  })
})
