// #8268 review Major 5 (re-review): this route used to honor a guard's denial but
// ignore its `modifiedPayload` — a transforming guard's rewritten decision/note was
// silently discarded and the original request body persisted instead. This proves the
// fix: when `runRouteMutationGuards` returns a `modifiedPayload`, it — not the raw
// parsed body — reaches `approvalService.decideApproval`.

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const CUSTOMER_ENTITY_ID = '55555555-5555-4555-8555-555555555555'
const APPROVAL_ID = '44444444-4444-4444-8444-444444444444'

const runRouteMutationGuardsMock = jest.fn()
const resolvePortalApprovalContextMock = jest.fn()
const enforceCommandOptimisticLockMock = jest.fn()
const decideApprovalMock = jest.fn()
const getApprovalMock = jest.fn()
const isApprovalVisibleToPortalPrincipalMock = jest.fn(() => true)

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLock: (...args: unknown[]) => enforceCommandOptimisticLockMock(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))
jest.mock('../../../../../../lib/portalApprovalAuth', () => ({
  resolvePortalApprovalContext: (...args: unknown[]) => resolvePortalApprovalContextMock(...args),
}))
jest.mock('../../../../../../lib/portalApprovalAccess', () => ({
  isApprovalVisibleToPortalPrincipal: (...args: unknown[]) => isApprovalVisibleToPortalPrincipalMock(...args),
}))
jest.mock('../../../../../../lib/approvalErrors', () => ({
  mapApprovalServiceError: () => null,
}))

import { POST } from '../route'

function routeCtx() {
  return { params: Promise.resolve({ id: APPROVAL_ID }) } as never
}

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/customer_groups/portal/approvals/x/decide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const existingApproval = {
  id: APPROVAL_ID,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

beforeEach(() => {
  jest.clearAllMocks()
  isApprovalVisibleToPortalPrincipalMock.mockReturnValue(true)
  getApprovalMock.mockResolvedValue(existingApproval)
  decideApprovalMock.mockResolvedValue({ id: APPROVAL_ID, status: 'approved' })
  resolvePortalApprovalContextMock.mockResolvedValue({
    auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID, customerEntityId: CUSTOMER_ENTITY_ID },
    principal: {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      customerEntityId: CUSTOMER_ENTITY_ID,
      customerUserId: USER_ID,
      canDecide: true,
    },
    em: {},
    approvalService: { getApproval: getApprovalMock, decideApproval: decideApprovalMock },
    container: {},
  })
})

describe('POST /api/customer_groups/portal/approvals/[id]/decide — guard modifiedPayload (Major 5)', () => {
  it('persists the guard-transformed decision/note, never the original request body', async () => {
    runRouteMutationGuardsMock.mockResolvedValue({
      ok: true,
      modifiedPayload: { decision: 'rejected', note: 'sanitized by guard' },
      runAfterSuccess: jest.fn(async () => {}),
    })

    const res = await POST(jsonRequest({ decision: 'approved', note: 'original note' }), routeCtx())

    expect(res.status).toBe(200)
    expect(decideApprovalMock).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'rejected',
      note: 'sanitized by guard',
    }))
  })

  it('persists the original parsed body when the guard reports no transformation', async () => {
    runRouteMutationGuardsMock.mockResolvedValue({
      ok: true,
      modifiedPayload: undefined,
      runAfterSuccess: jest.fn(async () => {}),
    })

    const res = await POST(jsonRequest({ decision: 'approved', note: 'original note' }), routeCtx())

    expect(res.status).toBe(200)
    expect(decideApprovalMock).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'approved',
      note: 'original note',
    }))
  })
})
