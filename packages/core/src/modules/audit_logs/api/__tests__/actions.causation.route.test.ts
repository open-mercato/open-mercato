/** @jest-environment node */
import { GET as listActions } from '@open-mercato/core/modules/audit_logs/api/audit-logs/actions/route'
import { GET as exportActions } from '@open-mercato/core/modules/audit_logs/api/audit-logs/actions/export/route'

const mockRbac = { userHasAllFeatures: jest.fn() }
const mockActionLogs = { list: jest.fn() }
const mockEm = {}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'rbacService') return mockRbac
      if (token === 'actionLogService') return mockActionLogs
      if (token === 'em') return mockEm
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

const KEY_ID = '55555555-5555-4555-8555-555555555555'
const AGENT_USER_ID = '77777777-7777-4777-8777-777777777777'
const WORKFLOW_INSTANCE_ID = '66666666-6666-4666-8666-666666666666'
const CORRELATION_ID = '11111111-1111-4111-8111-111111111111'
const PARENT_LOG_ID = '22222222-2222-4222-8222-222222222222'
const LIST_URL = 'http://localhost/api/audit_logs/audit-logs/actions'
const EXPORT_URL = 'http://localhost/api/audit_logs/audit-logs/actions/export'
const baseDate = new Date('2026-10-08T12:00:00.000Z')

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'action-1',
    commandId: 'customers.people.update',
    actionLabel: 'Update person',
    executionState: 'done',
    actorUserId: 'user-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    resourceKind: 'customers.person',
    resourceId: 'person-1',
    parentResourceKind: null,
    parentResourceId: null,
    undoToken: null,
    createdAt: baseDate,
    updatedAt: baseDate,
    snapshotBefore: null,
    snapshotAfter: null,
    changesJson: null,
    contextJson: null,
    ...overrides,
  }
}

async function authenticate() {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
}

describe('audit action routes — causation filters and fields', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    const { resolveFeatureCheckContext } = await import('@open-mercato/core/modules/directory/utils/organizationScope')
    ;(resolveFeatureCheckContext as jest.Mock).mockResolvedValue({
      organizationId: 'org-1',
      scope: { allowedIds: null },
    })
    const { loadAuditLogDisplayMaps } = await import('@open-mercato/core/modules/audit_logs/api/audit-logs/display')
    ;(loadAuditLogDisplayMaps as jest.Mock).mockResolvedValue({ users: {}, tenants: {}, organizations: {} })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockActionLogs.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 })
    await authenticate()
  })

  it('passes cause filters to the action log service', async () => {
    const res = await listActions(new Request(
      `${LIST_URL}?causeKind=api_key&causeId=${KEY_ID}&correlationId=${CORRELATION_ID}`,
    ))

    expect(res.status).toBe(200)
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      causeKind: 'api_key',
      causeId: KEY_ID,
      correlationId: CORRELATION_ID,
    }))
  })

  it('treats blank cause params as absent', async () => {
    const res = await listActions(new Request(`${LIST_URL}?causeKind=&causeId=%20&correlationId=`))

    expect(res.status).toBe(200)
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({
      causeKind: undefined,
      causeId: undefined,
      correlationId: undefined,
    }))
  })

  it.each([
    ['causeId without causeKind', `causeId=${KEY_ID}`],
    ['an unknown causeKind', 'causeKind=made_up'],
    ['a malformed correlationId', 'correlationId=not-a-uuid'],
    ['an oversized causeId', `causeKind=workflow&causeId=${'x'.repeat(201)}`],
  ])('rejects %s with 400 before querying', async (_label, query) => {
    const res = await listActions(new Request(`${LIST_URL}?${query}`))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Validation failed')
    expect(mockActionLogs.list).not.toHaveBeenCalled()
  })

  it('serializes the cause fields and defaults legacy rows to null', async () => {
    mockActionLogs.list.mockResolvedValue({
      items: [
        makeEntry({
          id: 'action-new',
          causeKind: 'api_key',
          causeId: KEY_ID,
          correlationId: CORRELATION_ID,
          causedByLogId: PARENT_LOG_ID,
        }),
        makeEntry({ id: 'action-legacy' }),
      ],
      total: 2,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })

    const res = await listActions(new Request(LIST_URL))
    const body = await res.json()

    expect(body.items[0]).toEqual(expect.objectContaining({
      id: 'action-new',
      causeKind: 'api_key',
      causeId: KEY_ID,
      correlationId: CORRELATION_ID,
      causedByLogId: PARENT_LOG_ID,
    }))
    expect(body.items[1]).toEqual(expect.objectContaining({
      id: 'action-legacy',
      causeKind: null,
      causeId: null,
      correlationId: null,
      causedByLogId: null,
    }))
  })

  it('applies the same cause filters to the CSV export', async () => {
    const res = await exportActions(new Request(`${EXPORT_URL}?causeKind=undo&correlationId=${CORRELATION_ID}`))

    expect(res.status).toBe(200)
    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({
      causeKind: 'undo',
      causeId: undefined,
      correlationId: CORRELATION_ID,
    }))
  })

  it('rejects an export causeId without causeKind with 400', async () => {
    const res = await exportActions(new Request(`${EXPORT_URL}?causeId=${KEY_ID}`))

    expect(res.status).toBe(400)
    expect(mockActionLogs.list).not.toHaveBeenCalled()
  })

  describe('for a view_self caller without audit_logs.view_tenant', () => {
    beforeEach(() => {
      mockRbac.userHasAllFeatures.mockResolvedValue(false)
    })

    it('keeps cause and correlation filters scoped to the caller\'s own rows', async () => {
      const res = await listActions(new Request(
        `${LIST_URL}?causeKind=agent&causeId=${AGENT_USER_ID}&correlationId=${CORRELATION_ID}&actorUserId=other-user`,
      ))

      expect(res.status).toBe(200)
      expect(mockRbac.userHasAllFeatures).toHaveBeenCalledWith(
        'user-1',
        ['audit_logs.view_tenant'],
        { tenantId: 'tenant-1', organizationId: 'org-1' },
      )
      expect(mockActionLogs.list).toHaveBeenCalledTimes(1)
      const [query] = mockActionLogs.list.mock.calls[0]
      expect(query).toEqual(expect.objectContaining({
        tenantId: 'tenant-1',
        actorSubject: 'user-1',
        actorUserId: undefined,
        actorUserIds: undefined,
        causeKind: 'agent',
        causeId: AGENT_USER_ID,
        correlationId: CORRELATION_ID,
      }))
      const body = await res.json()
      expect(body.canViewTenant).toBe(false)
    })

    it('scopes a correlation-only filter to the caller\'s own rows', async () => {
      const res = await listActions(new Request(`${LIST_URL}?correlationId=${CORRELATION_ID}`))

      expect(res.status).toBe(200)
      expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({
        actorSubject: 'user-1',
        causeKind: undefined,
        correlationId: CORRELATION_ID,
      }))
    })

    it.each(['agent', 'user'])('hides other principals behind a %s cause', async (causeKind) => {
      const envelope = {
        correlationId: CORRELATION_ID,
        causedByLogId: PARENT_LOG_ID,
        frames: [{ kind: 'user', id: 'user-9' }, { kind: causeKind, id: AGENT_USER_ID, meta: { model: 'm-1' } }],
      }
      mockActionLogs.list.mockResolvedValue({
        items: [makeEntry({
          causeKind,
          causeId: AGENT_USER_ID,
          correlationId: CORRELATION_ID,
          causedByLogId: PARENT_LOG_ID,
          contextJson: { source: 'ui', causation: envelope },
        })],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      })

      const res = await listActions(new Request(LIST_URL))
      const body = await res.json()

      expect(body.items[0]).toEqual(expect.objectContaining({
        causeKind,
        causeId: null,
        correlationId: CORRELATION_ID,
        causedByLogId: null,
      }))
      expect(body.items[0].context).toEqual({
        source: 'ui',
        causation: {
          correlationId: CORRELATION_ID,
          frames: [{ kind: 'user' }, { kind: causeKind, meta: { model: 'm-1' } }],
        },
      })
    })

    it('keeps non-principal cause ids while still stripping principal frame ids from the envelope', async () => {
      const envelope = {
        correlationId: CORRELATION_ID,
        causedByLogId: PARENT_LOG_ID,
        frames: [{ kind: 'agent', id: AGENT_USER_ID }, { kind: 'workflow', id: WORKFLOW_INSTANCE_ID, ref: 'step-1' }],
      }
      mockActionLogs.list.mockResolvedValue({
        items: [
          makeEntry({
            id: 'action-workflow',
            causeKind: 'workflow',
            causeId: WORKFLOW_INSTANCE_ID,
            correlationId: CORRELATION_ID,
            causedByLogId: PARENT_LOG_ID,
            contextJson: { causation: envelope },
          }),
          makeEntry({ id: 'action-plain', contextJson: { source: 'api' } }),
          makeEntry({ id: 'action-legacy' }),
        ],
        total: 3,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      })

      const res = await listActions(new Request(LIST_URL))
      const body = await res.json()

      expect(body.items[0]).toEqual(expect.objectContaining({
        causeKind: 'workflow',
        causeId: WORKFLOW_INSTANCE_ID,
        causedByLogId: PARENT_LOG_ID,
      }))
      expect(body.items[0].context).toEqual({
        causation: {
          correlationId: CORRELATION_ID,
          causedByLogId: PARENT_LOG_ID,
          frames: [{ kind: 'agent' }, { kind: 'workflow', id: WORKFLOW_INSTANCE_ID, ref: 'step-1' }],
        },
      })
      expect(body.items[1].context).toEqual({ source: 'api' })
      expect(body.items[2].context).toBeNull()
    })
  })

  it('shows principal cause ids and the full envelope to a view_tenant caller', async () => {
    const envelope = {
      correlationId: CORRELATION_ID,
      causedByLogId: PARENT_LOG_ID,
      frames: [{ kind: 'user' }, { kind: 'agent', id: AGENT_USER_ID }],
    }
    mockActionLogs.list.mockResolvedValue({
      items: [makeEntry({
        causeKind: 'agent',
        causeId: AGENT_USER_ID,
        correlationId: CORRELATION_ID,
        causedByLogId: PARENT_LOG_ID,
        contextJson: { causation: envelope },
      })],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })

    const res = await listActions(new Request(LIST_URL))
    const body = await res.json()

    expect(mockActionLogs.list).toHaveBeenCalledWith(expect.objectContaining({ actorSubject: undefined }))
    expect(body.items[0]).toEqual(expect.objectContaining({
      causeKind: 'agent',
      causeId: AGENT_USER_ID,
      causedByLogId: PARENT_LOG_ID,
      context: { causation: envelope },
    }))
  })
})
