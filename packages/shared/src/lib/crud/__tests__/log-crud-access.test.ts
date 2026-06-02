import { flushPendingCrudAccessLogs, logCrudAccess } from '@open-mercato/shared/lib/crud/factory'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

function makeContainer(service: { log: jest.Mock; logMany?: jest.Mock }) {
  const registrations = { accessLogService: service }
  return {
    registrations,
    resolve: (key: string) => (key === 'accessLogService' ? service : undefined),
  } as any
}

const auth: AuthContext = {
  sub: '11111111-1111-4111-8111-111111111111',
  email: 'u@example.com',
  tenantId: '22222222-2222-4222-8222-222222222222',
  orgId: '33333333-3333-4333-8333-333333333333',
} as any

function makeItems(count: number) {
  return Array.from({ length: count }, (_, idx) => ({
    id: `00000000-0000-4000-8000-${String(idx).padStart(12, '0')}`,
    title: `Row ${idx}`,
  }))
}

describe('logCrudAccess', () => {
  const originalBlocking = process.env.OM_CRUD_ACCESS_LOG_BLOCKING

  afterEach(async () => {
    await flushPendingCrudAccessLogs()
    if (originalBlocking === undefined) delete process.env.OM_CRUD_ACCESS_LOG_BLOCKING
    else process.env.OM_CRUD_ACCESS_LOG_BLOCKING = originalBlocking
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

  it('does not await writes when OM_CRUD_ACCESS_LOG_BLOCKING is unset', async () => {
    delete process.env.OM_CRUD_ACCESS_LOG_BLOCKING
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
    const start = process.hrtime.bigint()
    const result = await logCrudAccess({
      container: makeContainer(service),
      auth,
      items,
      idField: 'id',
      resourceKind: 'example.todo',
    })
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000
    // The outer logCrudAccess call should return immediately, even though
    // logMany has not resolved yet. Allow a generous 50 ms ceiling for CI noise.
    expect(elapsedMs).toBeLessThan(50)
    expect(service.logMany).toHaveBeenCalledTimes(1)
    expect(result.mode).toBe('batch')
    expect(result.count).toBe(5)
    expect(result.pending).toBeGreaterThan(0)
    resolveLogMany()
    await flushPendingCrudAccessLogs()
  })

  it('flushPendingCrudAccessLogs drains in-flight writes', async () => {
    delete process.env.OM_CRUD_ACCESS_LOG_BLOCKING
    let completed = 0
    const service = {
      log: jest.fn(async () => {}),
      logMany: jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        completed += 1
      }),
    }
    await logCrudAccess({
      container: makeContainer(service),
      auth,
      items: makeItems(2),
      idField: 'id',
      resourceKind: 'example.todo',
    })
    expect(completed).toBe(0)
    await flushPendingCrudAccessLogs()
    expect(completed).toBe(1)
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
