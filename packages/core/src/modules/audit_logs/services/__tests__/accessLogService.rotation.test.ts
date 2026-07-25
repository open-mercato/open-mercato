jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  resolveTenantEncryptionService: jest.fn(() => null),
}))

type ServiceModule = typeof import('../accessLogService')

const ROTATE_INTERVAL_ENV = 'AUDIT_LOGS_ROTATE_INTERVAL_MS'

function loadServiceModule(intervalMs: string | undefined): ServiceModule {
  let mod: ServiceModule | undefined
  jest.isolateModules(() => {
    if (intervalMs === undefined) delete process.env[ROTATE_INTERVAL_ENV]
    else process.env[ROTATE_INTERVAL_ENV] = intervalMs
    mod = require('../accessLogService') as ServiceModule
  })
  if (!mod) throw new Error('[internal] failed to load accessLogService module')
  return mod
}

function makeFakeEm() {
  const nativeDeleteCalls: unknown[] = []
  const fork = {
    getConnection: () => ({
      execute: jest.fn(async () => [{ id: '00000000-0000-4000-8000-000000000001' }]),
    }),
    nativeDelete: jest.fn(async (_entity: unknown, where: unknown) => {
      nativeDeleteCalls.push(where)
      return 0
    }),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
  }
  const em = {
    fork: jest.fn(() => fork),
  }
  return { em, nativeDeleteCalls }
}

function payload(idx: number) {
  return {
    tenantId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    actorUserId: '33333333-3333-4333-8333-333333333333',
    resourceKind: 'example.todo',
    resourceId: `00000000-0000-4000-8000-${String(idx).padStart(12, '0')}`,
    accessType: 'read:list',
    fields: ['id', 'title'],
    context: { resultCount: 50 },
  }
}

const originalRotateInterval = process.env[ROTATE_INTERVAL_ENV]

afterEach(() => {
  if (originalRotateInterval === undefined) delete process.env[ROTATE_INTERVAL_ENV]
  else process.env[ROTATE_INTERVAL_ENV] = originalRotateInterval
  jest.restoreAllMocks()
})

describe('access log rotation throttling', () => {
  it('rotates once per interval instead of on every write (default interval)', async () => {
    const { AccessLogService } = loadServiceModule(undefined)
    const { em, nativeDeleteCalls } = makeFakeEm()
    const service = new AccessLogService(em as never)

    await service.log(payload(0))
    expect(nativeDeleteCalls).toHaveLength(2)

    await service.log(payload(1))
    await service.logMany([payload(2), payload(3)])
    expect(nativeDeleteCalls).toHaveLength(2)
  })

  it('rotates again once the configured interval has elapsed', async () => {
    const { AccessLogService } = loadServiceModule('60000')
    const { em, nativeDeleteCalls } = makeFakeEm()
    const service = new AccessLogService(em as never)

    const baseTime = 1_750_000_000_000
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(baseTime)
    await service.log(payload(0))
    expect(nativeDeleteCalls).toHaveLength(2)

    nowSpy.mockReturnValue(baseTime + 59_999)
    await service.log(payload(1))
    expect(nativeDeleteCalls).toHaveLength(2)

    nowSpy.mockReturnValue(baseTime + 60_000)
    await service.log(payload(2))
    expect(nativeDeleteCalls).toHaveLength(4)
  })

  it('rotates on every write when the interval is 0', async () => {
    const { AccessLogService } = loadServiceModule('0')
    const { em, nativeDeleteCalls } = makeFakeEm()
    const service = new AccessLogService(em as never)

    await service.log(payload(0))
    await service.log(payload(1))
    await service.logMany([payload(2), payload(3)])
    expect(nativeDeleteCalls).toHaveLength(6)
  })

  it('falls back to the throttled default for invalid interval values', async () => {
    const { AccessLogService } = loadServiceModule('not-a-number')
    const { em, nativeDeleteCalls } = makeFakeEm()
    const service = new AccessLogService(em as never)

    await service.log(payload(0))
    await service.log(payload(1))
    expect(nativeDeleteCalls).toHaveLength(2)
  })
})
