import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { StaffTeamMember, StaffTimeProject } from '../../../../data/entities'

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '99999999-9999-4999-8999-999999999999'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const projectId = '44444444-4444-4444-8444-444444444444'

type ProjectRow = { id: string; tenantId: string; organizationId: string; name: string; deletedAt: Date | null }
type MemberRow = { userId: string; tenantId: string; organizationId: string; displayName: string; deletedAt: Date | null }

let projectRows: ProjectRow[] = []
let memberRows: MemberRow[] = []

const findOneWithDecryption = jest.fn(
  async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
    if (entity === StaffTimeProject) {
      return (
        projectRows.find(
          (row) =>
            row.id === where.id &&
            row.tenantId === where.tenantId &&
            row.organizationId === where.organizationId &&
            row.deletedAt === null,
        ) ?? null
      )
    }
    if (entity === StaffTeamMember) {
      return (
        memberRows.find(
          (row) =>
            row.userId === where.userId &&
            row.tenantId === where.tenantId &&
            row.organizationId === where.organizationId &&
            row.deletedAt === null,
        ) ?? null
      )
    }
    return null
  },
)

const emitStaffEvent = jest.fn(async () => {})

const cacheStore = new Map<string, unknown>()
let cacheAvailable = true
const cache = {
  get: jest.fn(async (key: string) => (cacheStore.has(key) ? cacheStore.get(key) : null)),
  set: jest.fn(async (key: string, value: unknown) => {
    cacheStore.set(key, value)
  }),
}

let grantedFeatures: string[] = ['staff.timesheets.view']

const em = { fork: () => em }

const container = {
  hasRegistration: (name: string) => ['em', 'rbacService', 'cache'].includes(name),
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return { getGrantedFeatures: async () => grantedFeatures }
    if (name === 'cache') {
      if (!cacheAvailable) throw new Error('[internal] cache not registered')
      return cache
    }
    throw new Error(`[internal] Unexpected container resolve: ${name}`)
  }),
}

let authValue: Record<string, unknown> | null = {
  tenantId: tenantA,
  sub: userId,
  orgId: organizationId,
  email: 'tomasz@example.test',
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
    t: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) =>
    (findOneWithDecryption as unknown as (...a: unknown[]) => unknown)(...args),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('../../../../events', () => ({
  emitStaffEvent: (...args: unknown[]) => emitStaffEvent(...(args as [])),
}))

import { POST, metadata, buildAccessRequestDedupeKey, ACCESS_REQUEST_DEDUPE_WINDOW_MS } from '../route'

const postRequest = (body?: unknown) =>
  new Request('http://localhost/api/staff/timesheets/access-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

describe('staff timesheets access-requests route', () => {
  beforeEach(() => {
    registerMutationGuards([])
    cacheStore.clear()
    cache.get.mockClear()
    cache.set.mockClear()
    emitStaffEvent.mockClear()
    container.resolve.mockClear()
    findOneWithDecryption.mockClear()
    cacheAvailable = true
    grantedFeatures = ['staff.timesheets.view']
    authValue = { tenantId: tenantA, sub: userId, orgId: organizationId, email: 'tomasz@example.test' }
    projectRows = [
      { id: projectId, tenantId: tenantA, organizationId, name: 'Fintechly Portal', deletedAt: null },
    ]
    memberRows = [
      { userId, tenantId: tenantA, organizationId, displayName: 'Tomasz Iwan', deletedAt: null },
    ]
  })

  afterAll(() => {
    registerMutationGuards([])
  })

  it('declares the feature guard required by the spec', () => {
    expect(metadata.POST.requireAuth).toBe(true)
    expect(metadata.POST.requireFeatures).toEqual(['staff.timesheets.view'])
  })

  it('emits a project-scoped request and reports it as not deduplicated', async () => {
    const response = await POST(postRequest({ timeProjectId: projectId }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, deduplicated: false })
    expect(emitStaffEvent).toHaveBeenCalledTimes(1)
    expect(emitStaffEvent).toHaveBeenCalledWith(
      'staff.timesheets.project_access.requested',
      expect.objectContaining({
        tenantId: tenantA,
        organizationId,
        requesterUserId: userId,
        requesterName: 'Tomasz Iwan',
        timeProjectId: projectId,
        timeProjectName: 'Fintechly Portal',
      }),
    )
  })

  it('emits a general request when no project is supplied', async () => {
    const response = await POST(postRequest({}))

    expect(response.status).toBe(200)
    expect(emitStaffEvent).toHaveBeenCalledWith(
      'staff.timesheets.project_access.requested',
      expect.objectContaining({ timeProjectId: null, timeProjectName: null }),
    )
  })

  it('falls back to the requester email when no staff member row exists', async () => {
    memberRows = []

    await POST(postRequest({}))

    expect(emitStaffEvent).toHaveBeenCalledWith(
      'staff.timesheets.project_access.requested',
      expect.objectContaining({ requesterName: 'tomasz@example.test' }),
    )
  })

  it('degrades a project from another tenant to a general request without leaking it', async () => {
    projectRows = [
      { id: projectId, tenantId: tenantB, organizationId, name: 'Other tenant project', deletedAt: null },
    ]

    const response = await POST(postRequest({ timeProjectId: projectId }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, deduplicated: false })
    expect(emitStaffEvent).toHaveBeenCalledWith(
      'staff.timesheets.project_access.requested',
      expect.objectContaining({ timeProjectId: null, timeProjectName: null }),
    )
  })

  it('suppresses a duplicate request inside the 24h window and still returns success', async () => {
    const first = await POST(postRequest({ timeProjectId: projectId }))
    expect(first.status).toBe(200)

    const second = await POST(postRequest({ timeProjectId: projectId }))

    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toEqual({ ok: true, deduplicated: true })
    expect(emitStaffEvent).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledWith(
      buildAccessRequestDedupeKey({
        tenantId: tenantA,
        organizationId,
        requesterUserId: userId,
        timeProjectId: projectId,
      }),
      expect.any(Object),
      { ttl: ACCESS_REQUEST_DEDUPE_WINDOW_MS },
    )
  })

  it('keeps the dedupe window per project and per requester', async () => {
    await POST(postRequest({ timeProjectId: projectId }))
    await POST(postRequest({}))

    expect(emitStaffEvent).toHaveBeenCalledTimes(2)
  })

  it('emits again once the dedupe window expired', async () => {
    await POST(postRequest({ timeProjectId: projectId }))
    cacheStore.clear()

    await POST(postRequest({ timeProjectId: projectId }))

    expect(emitStaffEvent).toHaveBeenCalledTimes(2)
  })

  it('still emits when no cache strategy is registered', async () => {
    cacheAvailable = false

    const response = await POST(postRequest({ timeProjectId: projectId }))

    expect(response.status).toBe(200)
    expect(emitStaffEvent).toHaveBeenCalledTimes(1)
  })

  it('rejects unauthenticated requests', async () => {
    authValue = null

    const response = await POST(postRequest({}))

    expect(response.status).toBe(401)
    expect(emitStaffEvent).not.toHaveBeenCalled()
  })

  it('rejects a request without organization scope', async () => {
    authValue = { tenantId: tenantA, sub: userId, orgId: null }

    const response = await POST(postRequest({}))

    expect(response.status).toBe(400)
    expect(emitStaffEvent).not.toHaveBeenCalled()
  })

  it('rejects a malformed project id with 400', async () => {
    const response = await POST(postRequest({ timeProjectId: 'not-a-uuid' }))

    expect(response.status).toBe(400)
    expect(emitStaffEvent).not.toHaveBeenCalled()
  })

  it('passes a blocking mutation guard response through untouched', async () => {
    const validate = jest.fn(async () => ({ ok: false, status: 423, body: { error: 'Locked' } }))
    const guard: MutationGuard = {
      id: 'test.access-request-guard',
      targetEntity: 'staff.timesheets.access_request',
      operations: ['create'],
      validate,
    }
    registerMutationGuards([{ moduleId: 'test', guards: [guard] }])

    const response = await POST(postRequest({ timeProjectId: projectId }))

    expect(response.status).toBe(423)
    await expect(response.json()).resolves.toEqual({ error: 'Locked' })
    expect(emitStaffEvent).not.toHaveBeenCalled()
    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: tenantA,
        organizationId,
        userId,
        resourceKind: 'staff.timesheets.access_request',
        resourceId: projectId,
        operation: 'create',
        requestMethod: 'POST',
      }),
    )
  })

  it('runs guard afterSuccess callbacks once the request was emitted', async () => {
    const afterSuccess = jest.fn(async () => {})
    const guard: MutationGuard = {
      id: 'test.access-request-after-success',
      targetEntity: '*',
      operations: ['create'],
      features: ['staff.timesheets.view'],
      validate: async () => ({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } }),
      afterSuccess,
    }
    registerMutationGuards([{ moduleId: 'test', guards: [guard] }])

    const response = await POST(postRequest({ timeProjectId: projectId }))

    expect(response.status).toBe(200)
    expect(afterSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceKind: 'staff.timesheets.access_request',
        operation: 'create',
        metadata: { token: 'guard' },
      }),
    )
  })

  it('skips feature-gated guards the caller cannot trigger', async () => {
    const validate = jest.fn(async () => ({ ok: false, status: 422, body: { error: 'Blocked' } }))
    const guard: MutationGuard = {
      id: 'test.access-request-gated-guard',
      targetEntity: '*',
      operations: ['create'],
      features: ['some_other_module.special'],
      validate,
    }
    registerMutationGuards([{ moduleId: 'test', guards: [guard] }])

    const response = await POST(postRequest({ timeProjectId: projectId }))

    expect(response.status).toBe(200)
    expect(validate).not.toHaveBeenCalled()
  })
})
