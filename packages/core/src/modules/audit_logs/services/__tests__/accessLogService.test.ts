jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  resolveTenantEncryptionService: jest.fn(() => null),
}))

import { AccessLogService, flushAccessLog } from '../accessLogService'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'

type ExecuteCall = { sql: string; params: unknown[] }

function makeFakeEm() {
  const executeCalls: ExecuteCall[] = []
  const nativeDeleteCalls: unknown[] = []
  const fork = {
    getConnection: () => ({
      execute: jest.fn(async (sql: string, params: unknown[]) => {
        executeCalls.push({ sql, params })
        return [{ id: '00000000-0000-4000-8000-000000000001' }]
      }),
    }),
    nativeDelete: jest.fn(async (_entity: unknown, where: unknown) => {
      nativeDeleteCalls.push(where)
      return 0
    }),
    create: jest.fn((_entity: unknown, data: any) => data),
  }
  const em = {
    fork: jest.fn(() => fork),
  }
  return { em, fork, executeCalls, nativeDeleteCalls }
}

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const actorUserId = '33333333-3333-4333-8333-333333333333'

function payload(idx: number) {
  return {
    tenantId,
    organizationId,
    actorUserId,
    resourceKind: 'example.todo',
    resourceId: `00000000-0000-4000-8000-${String(idx).padStart(12, '0')}`,
    accessType: 'read:list',
    fields: ['id', 'title'],
    context: { resultCount: 50 },
  }
}

describe('AccessLogService.logMany', () => {
  beforeEach(() => {
    ;(resolveTenantEncryptionService as jest.Mock).mockImplementation(() => null)
  })

  afterEach(async () => {
    await flushAccessLog()
    jest.clearAllMocks()
  })

  it('issues a single multi-row INSERT for a batch', async () => {
    const { em, executeCalls } = makeFakeEm()
    const service = new AccessLogService(em as any)
    const rows = Array.from({ length: 10 }, (_, idx) => payload(idx))
    const written = await service.logMany(rows)
    expect(written).toBe(10)
    expect(executeCalls).toHaveLength(1)
    const { sql, params } = executeCalls[0]!
    expect(sql).toMatch(/insert into "access_logs"/i)
    // 10 placeholder groups separated by ", "
    expect(sql.match(/\(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?\)/g)).toHaveLength(10)
    // 10 rows × 10 columns
    expect(params).toHaveLength(100)
  })

  it('chunks at MAX_BATCH_ROWS (500) per statement', async () => {
    const { em, executeCalls } = makeFakeEm()
    const service = new AccessLogService(em as any)
    const rows = Array.from({ length: 750 }, (_, idx) => payload(idx))
    const written = await service.logMany(rows)
    expect(written).toBe(750)
    expect(executeCalls).toHaveLength(2)
    expect(executeCalls[0]!.sql.match(/\(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?\)/g)).toHaveLength(500)
    expect(executeCalls[1]!.sql.match(/\(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?\)/g)).toHaveLength(250)
  })

  it('serializes JSON columns and preserves per-row scope', async () => {
    const { em, executeCalls } = makeFakeEm()
    const service = new AccessLogService(em as any)
    await service.logMany([payload(0), payload(1)])
    const params = executeCalls[0]!.params
    // Columns per row: tenantId, organizationId, actorUserId, resourceKind, resourceId, accessType, fieldsJson, contextJson, createdAt, deletedAt
    expect(params[0]).toBe(tenantId)
    expect(params[1]).toBe(organizationId)
    expect(params[2]).toBe(actorUserId)
    expect(params[3]).toBe('example.todo')
    expect(params[6]).toBe(JSON.stringify(['id', 'title']))
    expect(params[7]).toBe(JSON.stringify({ resultCount: 50 }))
    expect(params[9]).toBeNull()
  })

  it('stores encrypted JSON column strings as valid jsonb string values', async () => {
    const { em, executeCalls } = makeFakeEm()
    const encryptedFields = 'vjDNrr3ePbgk2Lt3:encrypted:payload:v1'
    const encryptedContext = 'iJC0P9hNV5Zx:encrypted:context:v1'
    const encryptionMock = {
      encryptEntityPayload: jest.fn(async (_entity: unknown, payloadIn: any) => ({
        ...payloadIn,
        fieldsJson: encryptedFields,
        contextJson: encryptedContext,
      })),
    }
    ;(resolveTenantEncryptionService as jest.Mock).mockImplementation(() => encryptionMock)

    const service = new AccessLogService(em as any)
    await service.logMany([payload(0)])
    const params = executeCalls[0]!.params
    expect(params[6]).toBe(JSON.stringify(encryptedFields))
    expect(params[7]).toBe(JSON.stringify(encryptedContext))
  })

  it('stores encrypted JSON column strings as valid jsonb string values for single writes', async () => {
    const { em, executeCalls } = makeFakeEm()
    const encryptedFields = 'vjDNrr3ePbgk2Lt3:encrypted:payload:v1'
    const encryptedContext = 'iJC0P9hNV5Zx:encrypted:context:v1'
    const encryptionMock = {
      encryptEntityPayload: jest.fn(async (_entity: unknown, payloadIn: any) => ({
        ...payloadIn,
        fieldsJson: encryptedFields,
        contextJson: encryptedContext,
      })),
    }
    ;(resolveTenantEncryptionService as jest.Mock).mockImplementation(() => encryptionMock)

    const service = new AccessLogService(em as any)
    await service.log(payload(0))
    const params = executeCalls[0]!.params
    expect(params[6]).toBe(JSON.stringify(encryptedFields))
    expect(params[7]).toBe(JSON.stringify(encryptedContext))
  })

  it('returns 0 and skips DB calls for empty input', async () => {
    const { em, executeCalls } = makeFakeEm()
    const service = new AccessLogService(em as any)
    expect(await service.logMany([])).toBe(0)
    expect(executeCalls).toHaveLength(0)
  })

  it('encrypts batch rows in parallel rather than sequentially', async () => {
    const { em } = makeFakeEm()
    const inflight = { count: 0, peak: 0 }
    const encryptionMock = {
      encryptEntityPayload: jest.fn(async (_entity: unknown, payloadIn: any) => {
        inflight.count += 1
        if (inflight.count > inflight.peak) inflight.peak = inflight.count
        await new Promise((resolve) => setTimeout(resolve, 5))
        inflight.count -= 1
        return payloadIn
      }),
    }
    ;(resolveTenantEncryptionService as jest.Mock).mockImplementation(() => encryptionMock)

    const service = new AccessLogService(em as any)
    const rows = Array.from({ length: 8 }, (_, idx) => payload(idx))
    await service.logMany(rows)
    expect(encryptionMock.encryptEntityPayload).toHaveBeenCalledTimes(8)
    // Sequential awaits would peak at 1; parallel awaits must peak at the chunk size.
    expect(inflight.peak).toBeGreaterThan(1)
  })
})

describe('flushAccessLog', () => {
  it('drains in-flight log writes from log()', async () => {
    const { em } = makeFakeEm()
    const service = new AccessLogService(em as any)
    let logCount = 0
    // Patch execute to introduce a tiny delay so the promise is genuinely
    // pending when flushAccessLog is called.
    const originalGetConnection = (em.fork() as any).getConnection
    ;(em.fork as any).mockImplementation(() => ({
      getConnection: () => ({
        execute: jest.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          logCount += 1
          return [{ id: '00000000-0000-4000-8000-000000000001' }]
        }),
      }),
      nativeDelete: jest.fn(async () => 0),
      create: jest.fn((_entity: unknown, data: any) => data),
    }))
    // Fire and don't await.
    void service.log(payload(0))
    expect(logCount).toBe(0)
    await flushAccessLog()
    expect(logCount).toBeGreaterThanOrEqual(1)
    void originalGetConnection
  })
})
