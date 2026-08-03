/** @jest-environment node */

const ACTOR_ORG_ID = '22222222-2222-4222-8222-222222222222'
const SCHEDULE_ID = '123e4567-e89b-12d3-a456-426614174070'
const INTEGRATION_ID = 'demo-provider'
const ACTOR_TENANT_ID = 'tenant-1'
const FOREIGN_TENANT_ID = 'tenant-2'

const mockGetAuthFromRequest = jest.fn()
const mockStartDataSyncRun = jest.fn()

const mockSyncRunService = {
  listRuns: jest.fn(),
}

const mockScheduleService = {
  listSchedules: jest.fn(),
  saveSchedule: jest.fn(),
}

const mockCrudMutationGuardService = {
  validateMutation: jest.fn(),
  afterMutationSuccess: jest.fn(),
}

const mockCreateRequestContainer = jest.fn(async () => ({
  resolve: (token: string) => {
    if (token === 'dataSyncRunService') return mockSyncRunService
    if (token === 'dataSyncScheduleService') return mockScheduleService
    if (token === 'crudMutationGuardService') return mockCrudMutationGuardService
    return null
  },
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({
  readJsonSafe: jest.fn((req: Request) => req.json()),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(() => mockCreateRequestContainer()),
}))

jest.mock('../../lib/start-run', () => ({
  startDataSyncRun: jest.fn((params: unknown) => mockStartDataSyncRun(params)),
}))

import { GET as listRuns } from '../runs'
import { GET as listSchedules, POST as createSchedule } from '../schedules/route'
import { POST as startRun } from '../run'

// `orgId: null` + `actorOrgId` set is exactly the shape `applySuperAdminScope` produces when the
// operator picks "all organizations". These routes used to answer 401 for it, and `apiFetch` reads
// 401 as an expired session — so the integrations page looped through /api/auth/session/refresh
// forever. Integrations was fixed in #4224; data_sync kept reproducing the loop.
function allOrganizationsAuth() {
  return { sub: 'user-1', tenantId: ACTOR_TENANT_ID, orgId: null, actorOrgId: ACTOR_ORG_ID }
}

// When the super-admin cookie override also switches tenants, `actorTenantId` preserves the
// actor's own tenant while `tenantId` is the selected one. Falling back to `actorOrgId` here
// would pair a tenant-1 organization with tenant-2 — a cross-tenant scope that must never
// reach services, persistence, or queues.
function foreignTenantAllOrganizationsAuth() {
  return {
    sub: 'user-1',
    tenantId: FOREIGN_TENANT_ID,
    orgId: null,
    actorOrgId: ACTOR_ORG_ID,
    actorTenantId: ACTOR_TENANT_ID,
    isSuperAdmin: true,
  }
}

function createScheduleRequest() {
  return new Request('http://localhost/api/data_sync/schedules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      integrationId: INTEGRATION_ID,
      entityType: 'products',
      direction: 'import',
      scheduleType: 'cron',
      scheduleValue: '0 * * * *',
      timezone: 'UTC',
      fullSync: false,
      isEnabled: true,
    }),
  })
}

function startRunRequest() {
  return new Request('http://localhost/api/data_sync/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      integrationId: INTEGRATION_ID,
      entityType: 'products',
      direction: 'import',
    }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSyncRunService.listRuns.mockResolvedValue({ items: [], total: 0 })
  mockScheduleService.listSchedules.mockResolvedValue({ items: [], total: 0 })
  mockScheduleService.saveSchedule.mockResolvedValue({
    id: SCHEDULE_ID,
    integrationId: INTEGRATION_ID,
    entityType: 'products',
    direction: 'import',
    scheduleType: 'cron',
    scheduleValue: '0 * * * *',
    timezone: 'UTC',
    fullSync: false,
    isEnabled: true,
    scheduledJobId: SCHEDULE_ID,
    lastRunAt: null,
    organizationId: ACTOR_ORG_ID,
    tenantId: ACTOR_TENANT_ID,
    createdAt: new Date('2026-05-01T10:00:00.000Z'),
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    deletedAt: null,
  })
  mockCrudMutationGuardService.validateMutation.mockResolvedValue({
    ok: true,
    shouldRunAfterSuccess: true,
    metadata: null,
  })
  mockCrudMutationGuardService.afterMutationSuccess.mockResolvedValue(undefined)
})

describe('data_sync routes in the all-organizations scope', () => {
  beforeEach(() => {
    mockGetAuthFromRequest.mockResolvedValue(allOrganizationsAuth())
  })

  it('lists runs scoped to the actor organization instead of answering 401', async () => {
    const response = await listRuns(new Request('http://localhost/api/data_sync/runs'))

    expect(response.status).toBe(200)
    expect(mockSyncRunService.listRuns).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: ACTOR_ORG_ID, tenantId: ACTOR_TENANT_ID },
    )
  })

  it('lists schedules scoped to the actor organization instead of answering 401', async () => {
    const response = await listSchedules(new Request('http://localhost/api/data_sync/schedules'))

    expect(response.status).toBe(200)
    expect(mockScheduleService.listSchedules).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: ACTOR_ORG_ID, tenantId: ACTOR_TENANT_ID },
    )
  })

  it('writes a schedule into the actor organization instead of answering 401', async () => {
    const response = await createSchedule(createScheduleRequest())

    expect(response.status).toBe(201)
    expect(mockScheduleService.saveSchedule).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: ACTOR_ORG_ID, tenantId: ACTOR_TENANT_ID },
      expect.anything(),
    )
    // The mutation guard must see the resolved organization too, not the null selection.
    expect(mockCrudMutationGuardService.validateMutation).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ACTOR_ORG_ID }),
    )
  })

  // 400, never 401: a valid session must not be pushed through the session-refresh loop just
  // because no organization can be resolved.
  it('answers 400 organization_scope_required when the caller has no organization to fall back to', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: ACTOR_TENANT_ID, orgId: null })

    const response = await listRuns(new Request('http://localhost/api/data_sync/runs'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'organization_scope_required' })
    expect(mockSyncRunService.listRuns).not.toHaveBeenCalled()
  })

  it('still answers 401 when there is no authenticated tenant', async () => {
    mockGetAuthFromRequest.mockResolvedValue(null)

    const response = await listRuns(new Request('http://localhost/api/data_sync/runs'))

    expect(response.status).toBe(401)
    expect(mockSyncRunService.listRuns).not.toHaveBeenCalled()
  })
})

describe('data_sync routes in a foreign-tenant all-organizations scope', () => {
  beforeEach(() => {
    mockGetAuthFromRequest.mockResolvedValue(foreignTenantAllOrganizationsAuth())
  })

  it('refuses to list runs with the actor organization of another tenant', async () => {
    const response = await listRuns(new Request('http://localhost/api/data_sync/runs'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'organization_scope_required' })
    expect(mockSyncRunService.listRuns).not.toHaveBeenCalled()
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
  })

  it('never persists a schedule with a cross-tenant organization/tenant pair', async () => {
    const response = await createSchedule(createScheduleRequest())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'organization_scope_required' })
    expect(mockScheduleService.saveSchedule).not.toHaveBeenCalled()
    expect(mockCrudMutationGuardService.validateMutation).not.toHaveBeenCalled()
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
  })

  it('never starts or enqueues a run with a cross-tenant organization/tenant pair', async () => {
    const response = await startRun(startRunRequest())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'organization_scope_required' })
    expect(mockStartDataSyncRun).not.toHaveBeenCalled()
    expect(mockCrudMutationGuardService.validateMutation).not.toHaveBeenCalled()
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
  })
})
