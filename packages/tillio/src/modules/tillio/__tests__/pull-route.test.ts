import { POST } from '../api/pull/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({ runRouteMutationGuards: jest.fn() }))
jest.mock('../lib/pull-job', () => ({
  ...jest.requireActual('../lib/pull-job'),
  resolvePullContext: jest.fn(),
}))
jest.mock('../lib/queue', () => ({
  ...jest.requireActual('../lib/queue'),
  getTillioQueue: jest.fn(),
}))

const { getAuthFromRequest } = jest.requireMock('@open-mercato/shared/lib/auth/server')
const { createRequestContainer } = jest.requireMock('@open-mercato/shared/lib/di/container')
const { runRouteMutationGuards } = jest.requireMock('@open-mercato/shared/lib/crud/route-mutation-guard')
const { resolvePullContext } = jest.requireMock('../lib/pull-job')
const { getTillioQueue } = jest.requireMock('../lib/queue')

const auth = { sub: 'user-1', tenantId: 'tn', orgId: 'org' }

function request(body: unknown): Request {
  return new Request('http://localhost/api/tillio/pull', { method: 'POST', body: JSON.stringify(body) })
}

// The route takes an advisory lock inside a transaction; the stub keeps the section running
// without a database, which is the only thing these cases need from it.
function createEm() {
  return {
    transactional: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> =>
      run({ getConnection: () => ({ execute: async () => undefined }) }),
  }
}

function createProgressService(overrides: Record<string, jest.Mock> = {}) {
  return {
    getActiveJobs: jest.fn().mockResolvedValue([]),
    createJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
    failJob: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function wire(progressService: ReturnType<typeof createProgressService>) {
  createRequestContainer.mockResolvedValue({
    resolve: (name: string) => {
      if (name === 'progressService') return progressService
      if (name === 'em') return createEm()
      return {}
    },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  getAuthFromRequest.mockResolvedValue(auth)
  resolvePullContext.mockResolvedValue({ readiness: { blocker: null }, environment: {}, operator: {} })
  runRouteMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess: jest.fn().mockResolvedValue(undefined) })
  getTillioQueue.mockReturnValue({ enqueue: jest.fn().mockResolvedValue(undefined) })
})

describe('POST /api/tillio/pull', () => {
  it('queues the pull and answers 202 with the progress job id', async () => {
    const progressService = createProgressService()
    wire(progressService)
    const enqueue = jest.fn().mockResolvedValue(undefined)
    getTillioQueue.mockReturnValue({ enqueue })

    const response = await POST(request({ from: '2026-08-01', to: '2026-08-02' }))

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({ ok: true, progressJobId: 'job-1' })
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-08-01', to: '2026-08-02' }))
  })

  it('runs the pull on the range a guard rewrote, not the one the caller sent', async () => {
    const progressService = createProgressService()
    wire(progressService)
    const enqueue = jest.fn().mockResolvedValue(undefined)
    getTillioQueue.mockReturnValue({ enqueue })
    runRouteMutationGuards.mockResolvedValue({
      ok: true,
      modifiedPayload: { to: '2026-08-01' },
      runAfterSuccess: jest.fn().mockResolvedValue(undefined),
    })

    const response = await POST(request({ from: '2026-08-01', to: '2026-08-31' }))

    expect(response.status).toBe(202)
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ to: '2026-08-01' }))
  })

  it('returns the guard response and creates nothing when a guard blocks the pull', async () => {
    const progressService = createProgressService()
    wire(progressService)
    runRouteMutationGuards.mockResolvedValue({
      ok: false,
      response: Response.json({ ok: false, error: 'blocked' }, { status: 422 }),
    })

    const response = await POST(request({ from: '2026-08-01', to: '2026-08-02' }))

    expect(response.status).toBe(422)
    expect(progressService.createJob).not.toHaveBeenCalled()
  })

  it('refuses a second pull while one is already running', async () => {
    const progressService = createProgressService({
      getActiveJobs: jest.fn().mockResolvedValue([{ jobType: 'tillio.calls.pull' }]),
    })
    wire(progressService)

    const response = await POST(request({ from: '2026-08-01', to: '2026-08-02' }))

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toMatchObject({ code: 'pull_already_running' })
    expect(progressService.createJob).not.toHaveBeenCalled()
  })

  it('fails the job it just created when the queue rejects the handover', async () => {
    const progressService = createProgressService()
    wire(progressService)
    getTillioQueue.mockReturnValue({ enqueue: jest.fn().mockRejectedValue(new Error('queue down')) })

    const response = await POST(request({ from: '2026-08-01', to: '2026-08-02' }))

    expect(response.status).toBe(500)
    // Left pending, the orphan would answer 429 to every later pull for this scope.
    expect(progressService.failJob).toHaveBeenCalledWith('job-1', expect.anything(), expect.anything())
  })

  it('refuses to queue a pull for a disabled integration', async () => {
    const progressService = createProgressService()
    wire(progressService)
    resolvePullContext.mockResolvedValue({
      readiness: { blocker: 'integration_disabled' },
      environment: {},
      operator: {},
    })

    const response = await POST(request({ from: '2026-08-01', to: '2026-08-02' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'integration_disabled', section: 'environment' })
    expect(progressService.createJob).not.toHaveBeenCalled()
  })
})
