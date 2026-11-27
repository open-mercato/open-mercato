/** @jest-environment node */
import { GET } from '@open-mercato/core/modules/audit_logs/api/audit-logs/actions/route'
import { actionLogListSchema } from '@open-mercato/core/modules/audit_logs/data/validators'
import {
  loadCustomerAuditRedactionContext,
  redactCustomerAuditEntry,
} from '@open-mercato/core/modules/customers/lib/auditRedaction'

import { registerResponseEnrichers } from '@open-mercato/shared/lib/crud/enricher-registry'
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'

const mockRbac = { userHasAllFeatures: jest.fn(), getGrantedFeatures: jest.fn() }
const mockActionLogs = { list: jest.fn() }
const mockEm = {}
// Mirrors the real DI registration in `customers/di.ts` against the generic
// `actionLogRedactionProvider` extension point (see
// `audit_logs/lib/actionLogRedaction.ts`) — a missing token simulates the
// customers module being disabled (see the "customers module disabled" tests
// below).
const mockActionLogRedactionProvider = {
  loadContext: loadCustomerAuditRedactionContext,
  redactEntry: redactCustomerAuditEntry,
}
// Toggled by the "customers module disabled" tests — mirrors Awilix throwing on
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
      if (token === 'actionLogRedactionProvider') {
        if (!customersModuleEnabled) throw new Error('AwilixResolutionError: Could not resolve actionLogRedactionProvider')
        return mockActionLogRedactionProvider
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

const baseDate = new Date('2024-06-15T12:00:00.000Z')

function makeActionLogEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'action-1',
    commandId: 'cmd-1',
    actionLabel: 'Create Product',
    executionState: 'done',
    actorUserId: 'user-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    resourceKind: 'product',
    resourceId: 'prod-1',
    parentResourceKind: null,
    parentResourceId: null,
    undoToken: 'undo-token-1',
    createdAt: baseDate,
    updatedAt: baseDate,
    snapshotBefore: null,
    snapshotAfter: { name: 'Widget' },
    changesJson: { name: [null, 'Widget'] },
    contextJson: null,
    ...overrides,
  }
}

describe('GET /api/audit_logs/audit-logs/actions', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    customersModuleEnabled = true
    delete (mockEm as Record<string, unknown>).find
    const { resolveFeatureCheckContext } = await import('@open-mercato/core/modules/directory/utils/organizationScope')
    ;(resolveFeatureCheckContext as jest.Mock).mockResolvedValue({
      organizationId: 'org-1',
      scope: { allowedIds: null },
    })
    const { loadAuditLogDisplayMaps } = await import('@open-mercato/core/modules/audit_logs/api/audit-logs/display')
    ;(loadAuditLogDisplayMaps as jest.Mock).mockResolvedValue({
      users: { 'user-1': 'Alice' },
      tenants: { 'tenant-1': 'Tenant' },
      organizations: { 'org-1': 'Org' },
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(false)
    mockActionLogs.list.mockResolvedValue({
      items: [makeActionLogEntry()],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })
  })

  it('returns 401 when unauthenticated', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
    expect(res.status).toBe(401)
  })

  it('returns paginated response with default page=1 pageSize=50', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
    expect(res.status).toBe(200)
    const data = await res.json()

    expect(data.page).toBe(1)
    expect(data.pageSize).toBe(50)
    expect(data.total).toBe(1)
    expect(data.totalPages).toBe(1)
    expect(data.items).toHaveLength(1)
    expect(data.items[0].actorUserName).toBe('Alice')
    expect(data.items[0].tenantName).toBe('Tenant')
    expect(data.items[0].organizationName).toBe('Org')
    expect(data.canViewTenant).toBe(false)

    const listQuery = mockActionLogs.list.mock.calls[0][0]
    expect(listQuery.page).toBeUndefined()
    expect(listQuery.pageSize).toBeUndefined()
    expect(listQuery.limit).toBeUndefined()
    expect(listQuery.offset).toBeUndefined()
  })

  it('keeps CrudForm sink snapshots private while returning the rest of the action context', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    const snapshot = {
      protocol: 'crud-form-section-sink/v1',
      before: { supplierReference: 'previous-reference' },
      after: { supplierReference: 'new-reference' },
    }
    const contextJson = {
      source: 'ui',
      extensions: {
        example: { brand: snapshot, legacy: { displayLabel: 'Public activity' } },
        erp: { supplier: snapshot },
      },
    }
    mockActionLogs.list.mockResolvedValue({
      items: [makeActionLogEntry({ resourceKind: 'example.todo', contextJson })],
      total: 1, page: 1, pageSize: 50, totalPages: 1,
    })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].context).toEqual({
      source: 'ui', extensions: { example: { legacy: { displayLabel: 'Public activity' } } },
    })
    expect(contextJson.extensions.example.brand).toBe(snapshot)
    expect(contextJson.extensions.erp.supplier).toBe(snapshot)
  })

  // Regression for issue #8887 — the route used to serialize decrypted CRM
  // interaction snapshots verbatim, exposing private email subjects/bodies to
  // any viewer with audit_logs.view_tenant regardless of CRM ownership.
  it('redacts private email title/body from a customers.interaction entry when the viewer is not the author', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockActionLogs.list.mockResolvedValue({
      items: [
        makeActionLogEntry({
          resourceKind: 'customers.interaction',
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
          snapshotAfter: null,
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].snapshotBefore.interaction.title).toBeNull()
    expect(data.items[0].snapshotBefore.interaction.body).toBeNull()
  })

  it('leaves private email title/body visible to its own author', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    ;(mockEm as Record<string, unknown>).find = jest.fn(async (_entity: unknown, where: { id?: { $in?: string[] } }) =>
      where.id?.$in?.includes('verified-interaction')
        ? [{ id: 'verified-interaction', visibility: 'private', authorUserId: 'user-1', channelId: null, entity: 'person-1' }]
        : [],
    )
    mockActionLogs.list.mockResolvedValue({
      items: [
        makeActionLogEntry({
          resourceKind: 'customers.interaction',
          resourceId: 'verified-interaction',
          snapshotBefore: {
            interaction: {
              entityId: 'person-1',
              interactionType: 'email',
              visibility: 'private',
              authorUserId: 'user-1',
              title: 'Private subject',
              body: 'Private body',
            },
          },
          snapshotAfter: null,
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].snapshotBefore.interaction.title).toBe('Private subject')
    expect(data.items[0].snapshotBefore.interaction.body).toBe('Private body')
  })

  // Regression for the follow-up security finding on #8978 — the route only
  // redacted title/body, so a hidden private email's participants (addresses)
  // and linkedEntities still leaked to a viewer without live CRM access.
  it('redacts private email participants/linkedEntities from a customers.interaction entry when the viewer is not the author', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockActionLogs.list.mockResolvedValue({
      items: [
        makeActionLogEntry({
          resourceKind: 'customers.interaction',
          snapshotBefore: {
            interaction: {
              entityId: 'person-1',
              interactionType: 'email',
              visibility: 'private',
              authorUserId: 'user-2',
              title: 'Private subject',
              body: 'Private body',
              participants: [{ userId: 'user-3', name: 'Third Party', email: 'third@example.com' }],
              linkedEntities: [{ id: 'deal-1', type: 'deal', label: 'Confidential Deal' }],
            },
          },
          snapshotAfter: null,
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].snapshotBefore.interaction.participants).toBeNull()
    expect(data.items[0].snapshotBefore.interaction.linkedEntities).toBeNull()
  })

  it('leaves private email participants/linkedEntities visible to its own author', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    ;(mockEm as Record<string, unknown>).find = jest.fn(async (_entity: unknown, where: { id?: { $in?: string[] } }) =>
      where.id?.$in?.includes('verified-interaction')
        ? [{ id: 'verified-interaction', visibility: 'private', authorUserId: 'user-1', channelId: null, entity: 'person-1' }]
        : [],
    )
    mockActionLogs.list.mockResolvedValue({
      items: [
        makeActionLogEntry({
          resourceKind: 'customers.interaction',
          resourceId: 'verified-interaction',
          snapshotBefore: {
            interaction: {
              entityId: 'person-1',
              interactionType: 'email',
              visibility: 'private',
              authorUserId: 'user-1',
              title: 'Private subject',
              body: 'Private body',
              participants: [{ userId: 'user-3', name: 'Third Party', email: 'third@example.com' }],
              linkedEntities: [{ id: 'deal-1', type: 'deal', label: 'Confidential Deal' }],
            },
          },
          snapshotAfter: null,
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].snapshotBefore.interaction.participants).toEqual([
      { userId: 'user-3', name: 'Third Party', email: 'third@example.com' },
    ])
    expect(data.items[0].snapshotBefore.interaction.linkedEntities).toEqual([
      { id: 'deal-1', type: 'deal', label: 'Confidential Deal' },
    ])
  })

  // Regression for @pkarw's review on #8978 (pullrequestreview-5909076861,
  // pullrequestreview-5909263810) — a stored `customers.interaction` snapshot's
  // own `visibility` describes the state AT THE TIME that audit entry was
  // recorded, which a later shared→private revocation can make stale. These
  // exercise the full response boundary (not just the helper) so a broken
  // `ActionLog.resourceId` → provider → JSON wiring would be caught here too.
  describe('live-authority revocation at the response boundary', () => {
    afterEach(() => {
      delete (mockEm as Record<string, unknown>).find
    })

    function mockLiveInteraction(row: Record<string, unknown> | null) {
      const find = jest.fn(async (_entityName: unknown, where: Record<string, unknown>) => {
        const idFilter = where?.id as { $in?: string[] } | undefined
        if (row && idFilter?.$in?.includes(row.id as string)) return [row]
        return []
      })
      ;(mockEm as Record<string, unknown>).find = find
      return find
    }

    it('hides a shared-at-the-time email after it has been revoked to private', async () => {
      const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
      ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
      mockRbac.userHasAllFeatures.mockResolvedValue(true)
      const find = mockLiveInteraction({
        id: 'interaction-1',
        visibility: 'private',
        authorUserId: 'user-2',
        channelId: null,
        entity: 'person-1',
      })
      mockActionLogs.list.mockResolvedValue({
        items: [
          makeActionLogEntry({
            resourceKind: 'customers.interaction',
            resourceId: 'interaction-1',
            snapshotBefore: {
              interaction: {
                id: 'interaction-1',
                entityId: 'person-1',
                interactionType: 'email',
                visibility: 'shared',
                authorUserId: 'user-2',
                title: 'Old shared subject',
                body: 'Old shared body',
              },
            },
            snapshotAfter: null,
          }),
        ],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      })

      const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.items[0].snapshotBefore.interaction.title).toBeNull()
      expect(data.items[0].snapshotBefore.interaction.body).toBeNull()
      // The batch query must be scoped to the caller's own tenant/organization.
      expect(find).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: { $in: ['interaction-1'] }, tenantId: 'tenant-1', organizationId: 'org-1' }),
        expect.anything(),
      )
    })

    it('keeps the revoked email visible to its own author', async () => {
      const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
      ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user-2', tenantId: 'tenant-1', orgId: 'org-1' })
      mockRbac.userHasAllFeatures.mockResolvedValue(true)
      mockLiveInteraction({
        id: 'interaction-1',
        visibility: 'private',
        authorUserId: 'user-2',
        channelId: null,
        entity: 'person-1',
      })
      mockActionLogs.list.mockResolvedValue({
        items: [
          makeActionLogEntry({
            resourceKind: 'customers.interaction',
            resourceId: 'interaction-1',
            snapshotBefore: {
              interaction: {
                id: 'interaction-1',
                entityId: 'person-1',
                interactionType: 'email',
                visibility: 'shared',
                authorUserId: 'user-2',
                title: 'Old shared subject',
              },
            },
            snapshotAfter: null,
          }),
        ],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      })

      const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
      const data = await res.json()
      expect(data.items[0].snapshotBefore.interaction.title).toBe('Old shared subject')
    })

    it.each(['user-1', 'user-2'])('hides unverified historical ownership from viewer %s when live authority is unavailable', async (viewerUserId) => {
      const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
      ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: viewerUserId, tenantId: 'tenant-1', orgId: 'org-1' })
      mockRbac.userHasAllFeatures.mockResolvedValue(true)
      mockLiveInteraction(null)
      mockActionLogs.list.mockResolvedValue({
        items: [
          makeActionLogEntry({
            resourceKind: 'customers.interaction',
            resourceId: 'interaction-deleted',
            snapshotBefore: {
              interaction: {
                id: 'interaction-deleted',
                entityId: 'person-1',
                interactionType: 'email',
                visibility: 'shared',
                authorUserId: 'user-2',
                title: 'Deleted-interaction subject',
              },
            },
            snapshotAfter: null,
          }),
        ],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      })

      const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
      const data = await res.json()
      expect(data.items[0].snapshotBefore.interaction.title).toBeNull()
    })

    it('does not widen access with a conversation-share grant for the historical (no-longer-current) parent after the interaction moved', async () => {
      const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
      ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
      mockRbac.userHasAllFeatures.mockResolvedValue(true)
      // The interaction now lives under person-2, but the grant was only ever
      // made for the OLD parent, person-1.
      const find = jest.fn(async (_entityName: unknown, where: Record<string, unknown>) => {
        const idFilter = where?.id as { $in?: string[] } | undefined
        if (idFilter?.$in?.includes('interaction-1')) {
          return [{ id: 'interaction-1', visibility: 'private', authorUserId: 'user-2', channelId: null, entity: 'person-2' }]
        }
        if ('ownerUserId' in where) {
          return [{ id: 'share-1', ownerUserId: 'user-2', personEntity: { id: 'person-1' } }]
        }
        return []
      })
      ;(mockEm as Record<string, unknown>).find = find
      mockActionLogs.list.mockResolvedValue({
        items: [
          makeActionLogEntry({
            resourceKind: 'customers.interaction',
            resourceId: 'interaction-1',
            snapshotBefore: {
              interaction: {
                id: 'interaction-1',
                entityId: 'person-1',
                interactionType: 'email',
                visibility: 'shared',
                authorUserId: 'user-2',
                title: 'Moved interaction subject',
              },
            },
            snapshotAfter: null,
          }),
        ],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      })

      const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
      const data = await res.json()
      expect(data.items[0].snapshotBefore.interaction.title).toBeNull()
    })

    // Regression for @pkarw's review on #8978 (pullrequestreview-5909526934) —
    // an embedded Person-history interaction whose ownership transferred to a
    // different user. A grant for the OLD (stored) author must not authorize
    // it; only a grant for the CURRENT (live) author may.
    it('does not authorize embedded Person history using a grant for the author it had before an ownership transfer', async () => {
      const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
      ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
      mockRbac.userHasAllFeatures.mockResolvedValue(true)
      const find = jest.fn(async (_entityName: unknown, where: Record<string, unknown>) => {
        const idFilter = where?.id as { $in?: string[] } | undefined
        if (idFilter?.$in?.includes('embedded-1')) {
          return [{ id: 'embedded-1', visibility: 'private', authorUserId: 'user-3', channelId: null, entity: 'person-1' }]
        }
        if ('ownerUserId' in where) {
          // The only share grant on record covers the OLD (stored) author, user-2.
          return [{ id: 'share-1', ownerUserId: 'user-2', personEntity: { id: 'person-1' } }]
        }
        return []
      })
      ;(mockEm as Record<string, unknown>).find = find
      mockActionLogs.list.mockResolvedValue({
        items: [
          makeActionLogEntry({
            resourceKind: 'customers.person',
            resourceId: 'person-1',
            snapshotBefore: {
              entity: { id: 'person-1' },
              interactions: [
                { id: 'embedded-1', interactionType: 'email', authorUserId: 'user-2', title: 'Secret subject', body: 'Secret body' },
              ],
            },
            snapshotAfter: null,
          }),
        ],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      })

      const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.items[0].snapshotBefore.interactions[0].title).toBeNull()
      expect(find).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: { $in: ['embedded-1'] }, tenantId: 'tenant-1', organizationId: 'org-1' }),
        expect.anything(),
      )
    })
  })

  // Regression for the maintainer review on #8978 — this generic route must not
  // statically import CRM business logic (`packages/core/AGENTS.md` § Cross-Module
  // Coupling). When the `customers` module is disabled (its DI service is never
  // registered), the route must fail CLOSED for protected resource kinds — disabling
  // the module does not delete existing `action_logs` rows, so a stored private
  // email must never be disclosed just because its policy provider is unavailable.
  it('suppresses protected entries when the customers module is disabled', async () => {
    customersModuleEnabled = false
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockActionLogs.list.mockResolvedValue({
      items: [
        makeActionLogEntry({
          resourceKind: 'customers.interaction',
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
          snapshotAfter: null,
          changesJson: { title: { from: 'Old private subject', to: 'Private subject' } },
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].snapshotBefore).toBeNull()
    expect(data.items[0].snapshotAfter).toBeNull()
    expect(data.items[0].changes).toBeNull()
    expect(JSON.stringify(data)).not.toContain('Private subject')
    expect(JSON.stringify(data)).not.toContain('Private body')
  })

  it('keeps unrelated resource kinds usable when the customers module is disabled', async () => {
    customersModuleEnabled = false
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockActionLogs.list.mockResolvedValue({
      items: [makeActionLogEntry()],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.items[0].snapshotAfter).toEqual({ name: 'Widget' })
  })

  it('passes page and pageSize to service', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })

    mockActionLogs.list.mockResolvedValue({
      items: [],
      total: 120,
      page: 3,
      pageSize: 25,
      totalPages: 5,
    })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions?page=3&pageSize=25'))
    expect(res.status).toBe(200)
    const data = await res.json()

    expect(data.page).toBe(3)
    expect(data.pageSize).toBe(25)
    expect(data.total).toBe(120)
    expect(data.totalPages).toBe(5)

    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({
      page: 3,
      pageSize: 25,
    }))
    const listQuery = mockActionLogs.list.mock.calls[0][0]
    expect(listQuery.limit).toBeUndefined()
    expect(listQuery.offset).toBeUndefined()
  })

  it('passes legacy limit and offset to service without inventing a page', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions?limit=20&offset=40'))
    expect(res.status).toBe(200)

    const listQuery = mockActionLogs.list.mock.calls[0][0]
    expect(listQuery.limit).toBe(20)
    expect(listQuery.offset).toBe(40)
    expect(listQuery.page).toBeUndefined()
    expect(listQuery.pageSize).toBeUndefined()
  })

  it('clamps pageSize to max 200', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })

    await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions?pageSize=999'))
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({
      pageSize: 200,
    }))
  })

  it('scopes to actor when canViewTenant is false', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(false)

    await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({
      actorSubject: 'user-1',
      actorUserId: undefined,
    }))
  })

  it('scopes API-key self views to the canonical subject', async () => {
    const keyId = '11111111-1111-4111-8111-111111111111'
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: `api_key:${keyId}`,
      keyId,
      isApiKey: true,
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(false)

    const response = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))

    expect(response.status).toBe(200)
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({
      actorSubject: `api_key:${keyId}`,
      actorUserId: undefined,
    }))
  })

  it('widens scope when canViewTenant is true', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.canViewTenant).toBe(true)
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: undefined,
    }))
  })

  it('passes undoableOnly filter', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })

    await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions?undoableOnly=true'))
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({
      undoableOnly: true,
    }))
  })

  it('passes the ids filter through while keeping the self-only actor scope', async () => {
    const logId = '55555555-5555-4555-8555-555555555555'
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(false)

    await GET(makeRequest(`http://localhost/api/audit_logs/audit-logs/actions?ids=${logId},not-a-uuid`))
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({
      ids: [logId],
      actorSubject: 'user-1',
    }))
  })

  it('sends no ids filter when the ids param is absent', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })

    await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))
    expect(mockActionLogs.list.mock.calls[0][0].ids).toBeUndefined()
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

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions?actorUserId=not-a-uuid'))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Validation failed')
  })

  // Regression for issue #3817 — a caller with no resolved tenant (unscoped API key or
  // tenant-less global account) holding `audit_logs.view_tenant` used to drop the tenant,
  // organization and actor predicates at once and read every tenant's action logs.
  //
  // Null, omitted and empty-string tenant are all exercised: `.ai/lessons.md` (2026-07-11)
  // records that covering only explicit null misses the omitted-scope path.
  const tenantlessAuthContexts: Array<[string, Record<string, unknown>]> = [
    ['explicit null tenantId', { sub: 'user-1', tenantId: null, orgId: null }],
    ['omitted tenantId', { sub: 'user-1', orgId: null }],
    ['empty-string tenantId', { sub: 'user-1', tenantId: '', orgId: null }],
  ]

  describe.each(tenantlessAuthContexts)('tenant-less non-superadmin caller (%s)', (_label, authContext) => {
    it('is rejected with 403 before the action-log service is reached', async () => {
      const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
      ;(getAuthFromRequest as jest.Mock).mockResolvedValue(authContext)
      mockRbac.userHasAllFeatures.mockResolvedValue(true)

      const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))

      expect(res.status).toBe(403)
      expect(mockActionLogs.list).not.toHaveBeenCalled()
    })
  })

  // An `audit_logs.view_tenant` holder whose organization visibility list is explicitly empty
  // resolves to no default organization, which used to drop the organization predicate and
  // read every organization's action logs in the tenant. Deny it the way undo/redo do.
  describe('explicitly empty organization scope', () => {
    const emptyScopes: Array<[string, Record<string, unknown>]> = [
      ['allowedIds: []', { selectedId: null, filterIds: null, allowedIds: [] }],
      ['filterIds: []', { selectedId: null, filterIds: [], allowedIds: null }],
    ]

    it.each(emptyScopes)('is rejected with 403 before the action-log service is reached (%s)', async (_label, scope) => {
      const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
      const { resolveFeatureCheckContext } = await import('@open-mercato/core/modules/directory/utils/organizationScope')
      ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
      ;(resolveFeatureCheckContext as jest.Mock).mockResolvedValue({ organizationId: null, scope })
      mockRbac.userHasAllFeatures.mockResolvedValue(true)

      const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))

      expect(res.status).toBe(403)
      expect(mockActionLogs.list).not.toHaveBeenCalled()
    })

    it('keeps the unrestricted all-organizations read unnarrowed', async () => {
      const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
      const { resolveFeatureCheckContext } = await import('@open-mercato/core/modules/directory/utils/organizationScope')
      ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
      ;(resolveFeatureCheckContext as jest.Mock).mockResolvedValue({
        organizationId: null,
        scope: { selectedId: null, filterIds: null, allowedIds: null },
      })
      mockRbac.userHasAllFeatures.mockResolvedValue(true)

      const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))

      expect(res.status).toBe(200)
      expect(mockActionLogs.list).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', organizationId: undefined, actorSubject: undefined }),
      )
    })
  })

  it('preserves the intentional cross-tenant read for a tenant-less superadmin', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: null,
      orgId: null,
      isSuperAdmin: true,
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))

    expect(res.status).toBe(200)
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({ tenantId: undefined }))
  })

  it('leaves a tenant-scoped caller tenant-filtered as before', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)

    const res = await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))

    expect(res.status).toBe(200)
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1' }))
  })

  describe('response enrichers', () => {
    const targeted: ResponseEnricher = {
      id: 'test.audit-flag',
      targetEntity: 'audit_logs.action_log',
      features: ['test.view'],
      async enrichOne(record) {
        return { ...record, _test: { seen: true } }
      },
      async enrichMany(records) {
        return records.map((record) => ({ ...record, _test: { seen: true } }))
      },
    }
    const wildcard: ResponseEnricher = {
      id: 'test.wildcard',
      targetEntity: '*',
      async enrichOne(record) {
        return { ...record, _wildcard: true }
      },
      async enrichMany(records) {
        return records.map((record) => ({ ...record, _wildcard: true }))
      },
    }

    beforeEach(async () => {
      const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
      ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    })

    afterEach(() => {
      registerResponseEnrichers([])
    })

    it('runs enrichers that target audit action rows for a caller holding their features, and skips wildcard ones', async () => {
      registerResponseEnrichers([{ moduleId: 'test', enrichers: [targeted, wildcard] }])
      mockRbac.getGrantedFeatures.mockResolvedValue(['test.view'])

      const data = await (await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))).json()

      expect(data.items[0]._test).toEqual({ seen: true })
      expect(data.items[0]).not.toHaveProperty('_wildcard')
      expect(mockRbac.getGrantedFeatures).toHaveBeenCalledWith('user-1', { tenantId: 'tenant-1', organizationId: 'org-1' })
    })

    it('skips a targeted enricher when the caller lacks its features', async () => {
      registerResponseEnrichers([{ moduleId: 'test', enrichers: [targeted] }])
      mockRbac.getGrantedFeatures.mockResolvedValue([])

      const data = await (await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))).json()

      expect(data.items[0]).not.toHaveProperty('_test')
    })

    it('does not resolve caller features when no enricher targets audit action rows', async () => {
      registerResponseEnrichers([{ moduleId: 'test', enrichers: [wildcard] }])

      const data = await (await GET(makeRequest('http://localhost/api/audit_logs/audit-logs/actions'))).json()

      expect(data.items[0]).not.toHaveProperty('_wildcard')
      expect(mockRbac.getGrantedFeatures).not.toHaveBeenCalled()
    })
  })
})
