/**
 * Regression coverage for the org-scoping gap found during the 2026-07-01 FCM
 * e2e run (see `.ai/specs/2026-07-01-push-delivery-e2e-findings.md`, Finding 1).
 *
 * `resolveRequestContext` never populates `selectedOrganizationId`, so notifications
 * created via `POST /api/notifications` used to be tenant-level (org=null). Devices,
 * push channels, and their encryption maps are all org-scoped, so a null-org
 * notification never reached an org member's device. The fix resolves the org the
 * same way every other org-scoped write does — the selected-org cookie, then the
 * caller's own `auth.orgId` — via `resolveOrganizationScopeForRequest`.
 */
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveNotificationService } from '../notificationService'
import { resolveNotificationContext } from '../routeHelpers'

jest.mock('@open-mercato/shared/lib/api/context', () => ({
  resolveRequestContext: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))
jest.mock('../notificationService', () => ({
  resolveNotificationService: jest.fn(() => ({ __service: true })),
}))

const resolveRequestContextMock = resolveRequestContext as jest.MockedFunction<typeof resolveRequestContext>
const resolveOrgScopeMock = resolveOrganizationScopeForRequest as jest.MockedFunction<
  typeof resolveOrganizationScopeForRequest
>
const resolveServiceMock = resolveNotificationService as jest.MockedFunction<typeof resolveNotificationService>

const TENANT = '00000000-0000-0000-0000-000000000001'
const AUTH_ORG = '00000000-0000-0000-0000-0000000000a1'
const SELECTED_ORG = '00000000-0000-0000-0000-0000000000b2'

function mockContext(auth: { tenantId?: string; orgId?: string | null; sub?: string } | null) {
  resolveRequestContextMock.mockResolvedValue({
    ctx: { container: { __container: true }, auth },
  } as never)
}

function mockScope(selectedId: string | null) {
  resolveOrgScopeMock.mockResolvedValue({
    selectedId,
    filterIds: selectedId ? [selectedId] : null,
    allowedIds: null,
    tenantId: TENANT,
  })
}

beforeEach(() => {
  resolveRequestContextMock.mockReset()
  resolveOrgScopeMock.mockReset()
  resolveServiceMock.mockClear()
})

describe('resolveNotificationContext organization scoping', () => {
  const req = new Request('http://localhost/api/notifications', { method: 'POST' })

  it('inherits the caller org (auth.orgId) when no org is explicitly selected', async () => {
    mockContext({ tenantId: TENANT, orgId: AUTH_ORG, sub: 'user-1' })
    mockScope(null)

    const { scope } = await resolveNotificationContext(req)

    // Finding 1: previously this was `ctx.selectedOrganizationId ?? null` === null,
    // which never matched the org-scoped device the same user registered.
    expect(scope.organizationId).toBe(AUTH_ORG)
    expect(scope.tenantId).toBe(TENANT)
    expect(scope.userId).toBe('user-1')
  })

  it('prefers an explicitly selected organization over the caller org', async () => {
    mockContext({ tenantId: TENANT, orgId: AUTH_ORG, sub: 'user-1' })
    mockScope(SELECTED_ORG)

    const { scope } = await resolveNotificationContext(req)

    expect(scope.organizationId).toBe(SELECTED_ORG)
  })

  it('stays tenant-level (org=null) when the caller has no org at all', async () => {
    mockContext({ tenantId: TENANT, orgId: null, sub: 'user-1' })
    mockScope(null)

    const { scope } = await resolveNotificationContext(req)

    expect(scope.organizationId).toBeNull()
  })
})
