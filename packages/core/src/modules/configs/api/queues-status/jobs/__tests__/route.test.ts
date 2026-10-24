/** @jest-environment node */

const authState: { auth: { sub: string; tenantId: string | null; orgId: string | null; isSuperAdmin?: boolean } | null } = {
  auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' },
}

const accessLogService = { log: jest.fn(async () => undefined) }
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'accessLogService') return accessLogService
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authState.auth),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

const inspectRecentJobs = jest.fn(async () => ({ jobs: [], crossTenant: false }))
jest.mock('../../../../lib/queue-job-inspector', () => ({
  inspectRecentJobs: (...args: unknown[]) => inspectRecentJobs(...args),
}))

const listRegisteredQueues = jest.fn(() => [{ queue: 'my-queue', workerIds: [], concurrency: null }])
jest.mock('../../../../lib/queue-status-registry', () => ({
  listRegisteredQueues: () => listRegisteredQueues(),
}))

import { GET } from '../route'

beforeEach(() => {
  jest.clearAllMocks()
  authState.auth = { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' }
  listRegisteredQueues.mockReturnValue([{ queue: 'my-queue', workerIds: [], concurrency: null }])
  inspectRecentJobs.mockResolvedValue({ jobs: [], crossTenant: false })
})

function request(query: string) {
  return new Request(`http://localhost/api/configs/queues-status/jobs?${query}`)
}

describe('GET /api/configs/queues-status/jobs (Tier 2)', () => {
  it('returns 401 when unauthenticated', async () => {
    authState.auth = null
    const res = await GET(request('queue=my-queue'))
    expect(res.status).toBe(401)
  })

  it('returns 400 for a missing required ?queue=', async () => {
    const res = await GET(request(''))
    expect(res.status).toBe(400)
    expect(inspectRecentJobs).not.toHaveBeenCalled()
  })

  it('returns an empty, non-erroring result for an unregistered queue name — never forwards it to the strategy', async () => {
    const res = await GET(request('queue=not-registered'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ jobs: [], crossTenant: false })
    expect(inspectRecentJobs).not.toHaveBeenCalled()
  })

  it('delegates to inspectRecentJobs with the actor scope derived from auth', async () => {
    authState.auth = { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1', isSuperAdmin: true }

    await GET(request('queue=my-queue&state=failed&limit=5&id=job-1'))

    expect(inspectRecentJobs).toHaveBeenCalledWith(expect.objectContaining({
      queue: 'my-queue',
      state: 'failed',
      limit: 5,
      id: 'job-1',
      actor: { actorUserId: 'user-1', tenantId: 'tenant-1', isSuperAdmin: true },
    }))
  })

  it('defaults isSuperAdmin to false when auth omits it', async () => {
    await GET(request('queue=my-queue'))

    expect(inspectRecentJobs).toHaveBeenCalledWith(expect.objectContaining({
      actor: { actorUserId: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false },
    }))
  })

  it('returns 500 when the inspector throws', async () => {
    inspectRecentJobs.mockRejectedValueOnce(new Error('boom'))

    const res = await GET(request('queue=my-queue'))

    expect(res.status).toBe(500)
  })
})
