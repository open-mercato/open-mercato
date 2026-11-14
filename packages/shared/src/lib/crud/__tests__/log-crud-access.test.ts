import { flushPendingCrudAccessLogs, logCrudAccess } from '@open-mercato/shared/lib/crud/factory'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

function makeContainer(service: { log: jest.Mock; logMany?: jest.Mock }, trustProxyDepth?: number) {
  const rateLimiterService = trustProxyDepth === undefined ? undefined : { trustProxyDepth }
  const registrations = {
    accessLogService: service,
    ...(rateLimiterService ? { rateLimiterService } : {}),
  }
  return {
    registrations,
    resolve: (key: string) => {
      if (key === 'accessLogService') return service
      if (key === 'rateLimiterService') return rateLimiterService
      return undefined
    },
  } as any
}

const auth: AuthContext = {
  sub: '11111111-1111-4111-8111-111111111111',
  email: 'u@example.com',
  tenantId: '22222222-2222-4222-8222-222222222222',
  orgId: '33333333-3333-4333-8333-333333333333',
  sid: '44444444-4444-4444-8444-444444444444',
} as any

function makeItems(count: number) {
  return Array.from({ length: count }, (_, idx) => ({
    id: `00000000-0000-4000-8000-${String(idx).padStart(12, '0')}`,
    title: `Row ${idx}`,
  }))
}

describe('logCrudAccess', () => {
  const originalBlocking = process.env.OM_CRUD_ACCESS_LOG_BLOCKING
  const originalMode = process.env.OM_CRUD_ACCESS_LOG_MODE

  afterEach(async () => {
    await flushPendingCrudAccessLogs()
    if (originalBlocking === undefined) delete process.env.OM_CRUD_ACCESS_LOG_BLOCKING
    else process.env.OM_CRUD_ACCESS_LOG_BLOCKING = originalBlocking
    if (originalMode === undefined) delete process.env.OM_CRUD_ACCESS_LOG_MODE
    else process.env.OM_CRUD_ACCESS_LOG_MODE = originalMode
  })

  it('prefers logMany() when the service exposes it', async () => {
    process.env.OM_CRUD_ACCESS_LOG_BLOCKING = '1'
    const service = {
      log: jest.fn(async () => {}),
      logMany: jest.fn(async (_payloads: unknown[]) => {}),
    }
    const items = makeItems(50)
    const result = await logCrudAccess({
      container: makeContainer(service),
      auth,
      items,
      idField: 'id',
      resourceKind: 'example.todo',
    })
    expect(service.logMany).toHaveBeenCalledTimes(1)
    const batch = service.logMany.mock.calls[0]?.[0] as Array<Record<string, unknown>>
    expect(Array.isArray(batch)).toBe(true)
    expect(batch).toHaveLength(50)
    expect(service.log).not.toHaveBeenCalled()
    expect(result.mode).toBe('blocking')
    expect(result.count).toBe(50)
  })

  it('falls back to per-row log() when logMany is missing', async () => {
    process.env.OM_CRUD_ACCESS_LOG_BLOCKING = '1'
    const service = { log: jest.fn(async () => {}) }
    const items = makeItems(3)
    const result = await logCrudAccess({
      container: makeContainer(service),
      auth,
      items,
      idField: 'id',
      resourceKind: 'example.todo',
    })
    expect(service.log).toHaveBeenCalledTimes(3)
    // dispatchMode reflects the underlying service shape even when the outer
    // call blocks — the profiler payload needs to distinguish "batched into
    // one INSERT" from "fanned out N INSERTs in blocking mode".
    expect(result.mode).toBe('blocking')
    expect(result.count).toBe(3)
  })

  it('waits for writes by default', async () => {
    delete process.env.OM_CRUD_ACCESS_LOG_BLOCKING
    delete process.env.OM_CRUD_ACCESS_LOG_MODE
    let resolveLogMany: () => void = () => {}
    const pendingLogMany = new Promise<void>((resolve) => {
      resolveLogMany = resolve
    })
    const service = {
      log: jest.fn(async () => {}),
      logMany: jest.fn(async (_payloads: unknown[]) => {
        await pendingLogMany
      }),
    }
    const items = makeItems(5)
    let settled = false
    const resultPromise = logCrudAccess({
      container: makeContainer(service),
      auth,
      items,
      idField: 'id',
      resourceKind: 'example.todo',
    })
    void resultPromise.finally(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(service.logMany).toHaveBeenCalledTimes(1)
    resolveLogMany()
    const result = await resultPromise
    expect(result.mode).toBe('blocking')
    expect(result.count).toBe(5)
  })

  it('supports explicit asynchronous writes and drains them', async () => {
    process.env.OM_CRUD_ACCESS_LOG_MODE = 'async'
    let completed = 0
    const service = {
      log: jest.fn(async () => {}),
      logMany: jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        completed += 1
      }),
    }
    const result = await logCrudAccess({
      container: makeContainer(service),
      auth,
      items: makeItems(2),
      idField: 'id',
      resourceKind: 'example.todo',
    })
    expect(result.mode).toBe('batch')
    expect(completed).toBe(0)
    await flushPendingCrudAccessLogs()
    expect(completed).toBe(1)
  })

  it('propagates write failures in blocking mode', async () => {
    delete process.env.OM_CRUD_ACCESS_LOG_MODE
    const service = {
      log: jest.fn(async () => {}),
      logMany: jest.fn(async () => {
        throw new Error('database unavailable')
      }),
    }

    await expect(logCrudAccess({
      container: makeContainer(service),
      auth,
      items: makeItems(1),
      idField: 'id',
      resourceKind: 'example.todo',
    })).rejects.toThrow('database unavailable')
  })

  it('records normalized request context and respects trusted proxy depth', async () => {
    const service = {
      log: jest.fn(async () => {}),
      logMany: jest.fn(async (_payloads: unknown[]) => {}),
    }
    const request = new Request('https://app.example.test/api/example/todos?page=1', {
      headers: {
        'user-agent': 'Audit Browser',
        'x-forwarded-for': '198.51.100.4, 10.0.0.10',
        'x-request-id': 'request-123',
      },
      method: 'GET',
    })

    await logCrudAccess({
      container: makeContainer(service, 1),
      auth,
      items: makeItems(1),
      idField: 'id',
      query: { page: 1 },
      request,
      resourceKind: 'example.todo',
    })

    const batch = service.logMany.mock.calls[0]?.[0] as Array<Record<string, unknown>>
    expect(batch[0]?.context).toEqual(expect.objectContaining({
      method: 'GET',
      operation: 'read',
      path: '/api/example/todos',
      requestId: 'request-123',
      result: 'success',
      sessionId: '44444444-4444-4444-8444-444444444444',
      sourceIp: '10.0.0.10',
      statusCode: 200,
      userAgent: 'Audit Browser',
    }))
  })

  it('does not trust forwarded IP headers without proxy configuration', async () => {
    const service = {
      log: jest.fn(async () => {}),
      logMany: jest.fn(async (_payloads: unknown[]) => {}),
    }
    const request = new Request('https://app.example.test/api/example/todos', {
      headers: { 'x-forwarded-for': '198.51.100.4' },
    })

    await logCrudAccess({
      container: makeContainer(service, 0),
      auth,
      items: makeItems(1),
      request,
      resourceKind: 'example.todo',
    })
    const batch = service.logMany.mock.calls[0]?.[0] as Array<Record<string, unknown>>
    expect(batch[0]?.context).toEqual(expect.objectContaining({ sourceIp: null }))
  })

  it('skips items without a normalized id and dedupes duplicate ids', async () => {
    process.env.OM_CRUD_ACCESS_LOG_BLOCKING = '1'
    const service = {
      log: jest.fn(async () => {}),
      logMany: jest.fn(async (_payloads: unknown[]) => {}),
    }
    const items = [
      { id: '00000000-0000-4000-8000-000000000001' },
      { id: '00000000-0000-4000-8000-000000000001' }, // dup
      { id: '' }, // empty
      { id: '00000000-0000-4000-8000-000000000002' },
    ]
    await logCrudAccess({
      container: makeContainer(service),
      auth,
      items,
      idField: 'id',
      resourceKind: 'example.todo',
    })
    const batch = service.logMany.mock.calls[0]?.[0] as Array<Record<string, unknown>>
    expect(batch).toHaveLength(2)
    expect(batch.map((p) => p.resourceId)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ])
  })
})
