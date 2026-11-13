/** @jest-environment node */
import { GET } from '@open-mercato/core/modules/audit_logs/api/audit-logs/actions/export/route'
import { actionLogListSchema } from '@open-mercato/core/modules/audit_logs/data/validators'
import {
  loadCustomerAuditRedactionContext,
  redactCustomerAuditEntry,
} from '@open-mercato/core/modules/customers/lib/auditRedaction'

const mockRbac = { userHasAllFeatures: jest.fn() }
const mockActionLogs = { list: jest.fn() }
const mockEm = {}
// Mirrors the real DI registration in `customers/di.ts` — the production
// container resolves this exact shape; a missing token simulates the customers
// module being disabled (see the "customers module disabled" test below).
const mockCustomersAuditRedactionService = {
  loadContext: loadCustomerAuditRedactionContext,
  redactEntry: redactCustomerAuditEntry,
}
// Toggled by the "customers module disabled" test — mirrors Awilix throwing on
// an unregistered token, which is exactly what `tryResolve` guards against.
let customersModuleEnabled = true

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'rbacService') return mockRbac
      if (token === 'actionLogService') return mockActionLogs
      if (token === 'em') return mockEm
      if (token === 'customersAuditRedactionService') {
        if (!customersModuleEnabled) throw new Error('AwilixResolutionError: Could not resolve customersAuditRedactionService')
        return mockCustomersAuditRedactionService
      }
      return null
    },
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/audit_logs/api/audit-logs/display', () => ({
  loadAuditLogDisplayMaps: jest.fn(),
}))

function makeRequest(url: string) {
  return new Request(url, { method: 'GET' })
}

describe('GET /api/audit_logs/audit-logs/actions/export', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    customersModuleEnabled = true
    const { resolveFeatureCheckContext } = await import('@open-mercato/core/modules/directory/utils/organizationScope')
    ;(resolveFeatureCheckContext as jest.Mock).mockResolvedValue({
      organizationId: 'org-1',
      scope: { allowedIds: null },
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(false)
  })

  it('returns 401 when unauthenticated', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions/export'))
    expect(res.status).toBe(401)
  })

  it('returns 400 (not 500) when a filter fails uuid validation', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    const parsed = actionLogListSchema.safeParse({ actorUserId: 'not-a-uuid' })
    if (parsed.success) throw new Error('expected actionLogListSchema to reject a non-uuid actorUserId')
    mockActionLogs.list.mockRejectedValueOnce(parsed.error)

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions/export?actorUserId=not-a-uuid'))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Validation failed')
  })

  // Regression for issue #3817 — the CSV export shares the read routes' scope handling, so
  // a tenant-less caller holding `audit_logs.view_tenant` could download every tenant's
  // decrypted action-log rows as a file.
  //
  // Null, omitted and empty-string tenant are all exercised: `.ai/lessons.md` (2026-07-11)
  // records that covering only explicit null misses the omitted-scope path.
  const tenantlessAuthContexts: Array<[string, Record<string, unknown>]> = [
    ['explicit null tenantId', { sub: 'user-1', tenantId: null, orgId: null }],
    ['omitted tenantId', { sub: 'user-1', orgId: null }],
    ['empty-string tenantId', { sub: 'user-1', tenantId: '', orgId: null }],
  ]

  describe.each(tenantlessAuthContexts)('tenant-less non-superadmin caller (%s)', (_label, authContext) => {
    it('is rejected with 403 before any rows are exported', async () => {
      const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
      ;(getAuthFromRequest as jest.Mock).mockResolvedValue(authContext)
      mockRbac.userHasAllFeatures.mockResolvedValue(true)

      const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions/export'))

      expect(res.status).toBe(403)
      expect(mockActionLogs.list).not.toHaveBeenCalled()
    })
  })

  it('preserves the intentional cross-tenant export for a tenant-less superadmin', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { loadAuditLogDisplayMaps } = await import('@open-mercato/core/modules/audit_logs/api/audit-logs/display')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: null,
      orgId: null,
      isSuperAdmin: true,
    })
    ;(loadAuditLogDisplayMaps as jest.Mock).mockResolvedValue({ users: {}, tenants: {}, organizations: {} })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockActionLogs.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions/export'))

    expect(res.status).toBe(200)
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({ tenantId: undefined }))
  })

  it('renders active, revoked, unresolved and actorless rows without ever showing a raw id', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { loadAuditLogDisplayMaps } = await import('@open-mercato/core/modules/audit_logs/api/audit-logs/display')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    ;(loadAuditLogDisplayMaps as jest.Mock).mockResolvedValue({
      users: {
        'active-key': 'API key: import',
        'revoked-key': 'API key: legacy-import (revoked)',
      },
      tenants: {},
      organizations: {},
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockActionLogs.list.mockResolvedValue({
      items: [
        { id: 'log-1', createdAt: new Date('2026-01-01T00:00:00.000Z'), actorUserId: 'active-key', actionLabel: 'Updated order', commandId: 'sales.orders.update' },
        { id: 'log-2', createdAt: new Date('2026-01-02T00:00:00.000Z'), actorUserId: 'revoked-key', actionLabel: 'Updated order', commandId: 'sales.orders.update' },
        { id: 'log-3', createdAt: new Date('2026-01-03T00:00:00.000Z'), actorUserId: 'ghost-user', actionLabel: 'Updated order', commandId: 'sales.orders.update' },
        { id: 'log-4', createdAt: new Date('2026-01-04T00:00:00.000Z'), actorUserId: null, actionLabel: 'System cleanup', commandId: 'system.cleanup' },
      ],
      total: 4,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions/export'))
    expect(res.status).toBe(200)
    const csv = await res.text()

    expect(csv).toContain('API key: import')
    expect(csv).toContain('API key: legacy-import (revoked)')
    expect(csv).toContain('Unknown user')
    expect(csv).toContain('System')
    expect(csv).not.toContain('active-key')
    expect(csv).not.toContain('revoked-key')
    expect(csv).not.toContain('ghost-user')
  })

  it('leaves a tenant-scoped caller tenant-filtered as before', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { loadAuditLogDisplayMaps } = await import('@open-mercato/core/modules/audit_logs/api/audit-logs/display')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    ;(loadAuditLogDisplayMaps as jest.Mock).mockResolvedValue({ users: {}, tenants: {}, organizations: {} })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockActionLogs.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions/export'))

    expect(res.status).toBe(200)
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1' }))
  })

  // Regression for issue #8887 — the CSV export fed snapshotBefore/changesJson
  // straight into the row builder, so a private email's subject/body change
  // leaked as a "title"/"body" row to any viewer with audit_logs.view_tenant.
  it('strips a private email title/body change from the exported rows when the viewer is not the author', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { loadAuditLogDisplayMaps } = await import('@open-mercato/core/modules/audit_logs/api/audit-logs/display')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    ;(loadAuditLogDisplayMaps as jest.Mock).mockResolvedValue({ users: {}, tenants: {}, organizations: {} })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockActionLogs.list.mockResolvedValue({
      items: [
        {
          id: 'action-1',
          commandId: 'cmd-1',
          actionLabel: 'Update interaction',
          actorUserId: 'user-2',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          resourceKind: 'customers.interaction',
          resourceId: 'interaction-1',
          createdAt: new Date('2024-06-15T12:00:00.000Z'),
          contextJson: null,
          snapshotBefore: {
            interaction: {
              entityId: 'person-1',
              interactionType: 'email',
              visibility: 'private',
              authorUserId: 'user-2',
              title: 'Old private subject',
              body: 'Old private body',
            },
          },
          changesJson: { title: { from: 'Old private subject', to: 'New private subject' } },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions/export'))

    expect(res.status).toBe(200)
    const csv = await res.text()
    expect(csv).not.toContain('Old private subject')
    expect(csv).not.toContain('New private subject')
  })

  // Regression for the follow-up security finding on #8978 — the CSV export only
  // stripped title/body, so a hidden private email's participant addresses and
  // linked-entity labels still rendered as "participants"/"linkedEntities" rows.
  it('strips private email participants/linkedEntities changes from the exported rows when the viewer is not the author', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { loadAuditLogDisplayMaps } = await import('@open-mercato/core/modules/audit_logs/api/audit-logs/display')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    ;(loadAuditLogDisplayMaps as jest.Mock).mockResolvedValue({ users: {}, tenants: {}, organizations: {} })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockActionLogs.list.mockResolvedValue({
      items: [
        {
          id: 'action-2',
          commandId: 'cmd-2',
          actionLabel: 'Update interaction',
          actorUserId: 'user-2',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          resourceKind: 'customers.interaction',
          resourceId: 'interaction-2',
          createdAt: new Date('2024-06-16T12:00:00.000Z'),
          contextJson: null,
          snapshotBefore: {
            interaction: {
              entityId: 'person-1',
              interactionType: 'email',
              visibility: 'private',
              authorUserId: 'user-2',
              title: 'Old private subject',
              body: 'Old private body',
              participants: [{ userId: 'user-3', name: 'Third Party', email: 'third@example.com' }],
              linkedEntities: [{ id: 'deal-1', type: 'deal', label: 'Confidential Deal' }],
            },
          },
          changesJson: {
            participants: { from: [], to: [{ userId: 'user-3', name: 'Third Party', email: 'third@example.com' }] },
            linkedEntities: { from: [], to: [{ id: 'deal-1', type: 'deal', label: 'Confidential Deal' }] },
          },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions/export'))

    expect(res.status).toBe(200)
    const csv = await res.text()
    expect(csv).not.toContain('third@example.com')
    expect(csv).not.toContain('Confidential Deal')
  })

  // Regression for the maintainer review on #8978 — the custom-field diff a
  // command-bus update produces lands as a top-level `cf_<name>` key, not the
  // nested `custom` key the earlier fix cleared from the snapshot.
  it('strips a canonical cf_<name> custom-field diff from the exported rows when the viewer is not the author', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { loadAuditLogDisplayMaps } = await import('@open-mercato/core/modules/audit_logs/api/audit-logs/display')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    ;(loadAuditLogDisplayMaps as jest.Mock).mockResolvedValue({ users: {}, tenants: {}, organizations: {} })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockActionLogs.list.mockResolvedValue({
      items: [
        {
          id: 'action-3',
          commandId: 'cmd-3',
          actionLabel: 'Update interaction',
          actorUserId: 'user-2',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          resourceKind: 'customers.interaction',
          resourceId: 'interaction-3',
          createdAt: new Date('2024-06-17T12:00:00.000Z'),
          contextJson: null,
          snapshotBefore: {
            interaction: {
              entityId: 'person-1',
              interactionType: 'email',
              visibility: 'private',
              authorUserId: 'user-2',
            },
          },
          changesJson: { cf_privateEmail: { from: 'old@example.test', to: 'new@example.test' } },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions/export'))

    expect(res.status).toBe(200)
    const csv = await res.text()
    expect(csv).not.toContain('old@example.test')
    expect(csv).not.toContain('new@example.test')
  })

  // Regression for the maintainer review on #8978 — exporting a non-email (call)
  // interaction's change history used to drop its real diff unconditionally.
  it('keeps the real changes diff for a non-email (call) interaction', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { loadAuditLogDisplayMaps } = await import('@open-mercato/core/modules/audit_logs/api/audit-logs/display')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    ;(loadAuditLogDisplayMaps as jest.Mock).mockResolvedValue({ users: {}, tenants: {}, organizations: {} })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockActionLogs.list.mockResolvedValue({
      items: [
        {
          id: 'action-4',
          commandId: 'cmd-4',
          actionLabel: 'Update interaction',
          actorUserId: 'user-2',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          resourceKind: 'customers.interaction',
          resourceId: 'interaction-4',
          createdAt: new Date('2024-06-18T12:00:00.000Z'),
          contextJson: null,
          snapshotBefore: {
            interaction: {
              entityId: 'person-1',
              interactionType: 'call',
              visibility: 'private',
              authorUserId: 'user-2',
            },
          },
          changesJson: { title: { from: 'Old call title', to: 'New call title' } },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions/export'))

    expect(res.status).toBe(200)
    const csv = await res.text()
    expect(csv).toContain('Old call title')
    expect(csv).toContain('New call title')
  })

  // Regression for the maintainer review on #8978 — this generic route must not
  // statically import CRM business logic (`packages/core/AGENTS.md` § Cross-Module
  // Coupling). When the `customers` module is disabled (its DI service is never
  // registered), the export degrades gracefully instead of throwing.
  it('exports entries unredacted when the customers module is disabled', async () => {
    customersModuleEnabled = false
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { loadAuditLogDisplayMaps } = await import('@open-mercato/core/modules/audit_logs/api/audit-logs/display')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    ;(loadAuditLogDisplayMaps as jest.Mock).mockResolvedValue({ users: {}, tenants: {}, organizations: {} })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockActionLogs.list.mockResolvedValue({
      items: [
        {
          id: 'action-5',
          commandId: 'cmd-5',
          actionLabel: 'Update interaction',
          actorUserId: 'user-2',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          resourceKind: 'customers.interaction',
          resourceId: 'interaction-5',
          createdAt: new Date('2024-06-19T12:00:00.000Z'),
          contextJson: null,
          snapshotBefore: {
            interaction: {
              entityId: 'person-1',
              interactionType: 'email',
              visibility: 'private',
              authorUserId: 'user-2',
              title: 'Private subject',
              body: 'Private body',
            },
          },
          changesJson: { title: { from: 'Old private subject', to: 'Private subject' } },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions/export'))

    expect(res.status).toBe(200)
    const csv = await res.text()
    expect(csv).toContain('Private subject')
  })

  it('uses the canonical API-key subject for self-only exports', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { loadAuditLogDisplayMaps } = await import('@open-mercato/core/modules/audit_logs/api/audit-logs/display')
    const keyId = '11111111-1111-4111-8111-111111111111'
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: `api_key:${keyId}`,
      keyId,
      isApiKey: true,
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    ;(loadAuditLogDisplayMaps as jest.Mock).mockResolvedValue({ users: {}, tenants: {}, organizations: {} })
    mockRbac.userHasAllFeatures.mockResolvedValue(false)
    mockActionLogs.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions/export'))

    expect(res.status).toBe(200)
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({
      actorSubject: `api_key:${keyId}`,
      actorUserId: undefined,
    }))
  })
})
