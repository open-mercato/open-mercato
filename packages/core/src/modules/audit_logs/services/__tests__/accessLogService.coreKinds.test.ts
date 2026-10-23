jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  resolveTenantEncryptionService: jest.fn(() => null),
}))

type ServiceModule = typeof import('../accessLogService')

const EXTRA_ENV = 'AUDIT_LOGS_CORE_RESOURCE_KINDS_EXTRA'
const ROTATE_INTERVAL_ENV = 'AUDIT_LOGS_ROTATE_INTERVAL_MS'

const originalExtra = process.env[EXTRA_ENV]
const originalRotateInterval = process.env[ROTATE_INTERVAL_ENV]

function loadServiceModule(extra: string | undefined): ServiceModule {
  let mod: ServiceModule | undefined
  jest.isolateModules(() => {
    if (extra === undefined) delete process.env[EXTRA_ENV]
    else process.env[EXTRA_ENV] = extra
    process.env[ROTATE_INTERVAL_ENV] = '0'
    mod = require('../accessLogService') as ServiceModule
  })
  if (!mod) throw new Error('[internal] failed to load accessLogService module')
  return mod
}

function makeFakeEm() {
  const nativeDeleteCalls: Array<{ resourceKind: Record<string, string[]>; createdAt: { $lt: Date } }> = []
  const fork = {
    getConnection: () => ({
      execute: jest.fn(async () => [{ id: '00000000-0000-4000-8000-000000000001' }]),
    }),
    nativeDelete: jest.fn(async (_entity: unknown, where: { resourceKind: Record<string, string[]>; createdAt: { $lt: Date } }) => {
      nativeDeleteCalls.push(where)
      return 0
    }),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
  }
  return { em: { fork: jest.fn(() => fork) }, nativeDeleteCalls }
}

const logPayload = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  actorUserId: '33333333-3333-4333-8333-333333333333',
  resourceKind: 'ai_assistant.mcp_tool_call',
  resourceId: '00000000-0000-4000-8000-000000000002',
  accessType: 'read:list',
  fields: ['id'],
  context: {},
}

afterEach(() => {
  if (originalExtra === undefined) delete process.env[EXTRA_ENV]
  else process.env[EXTRA_ENV] = originalExtra
  if (originalRotateInterval === undefined) delete process.env[ROTATE_INTERVAL_ENV]
  else process.env[ROTATE_INTERVAL_ENV] = originalRotateInterval
  jest.restoreAllMocks()
})

describe('resolveCoreResourceKinds', () => {
  it('returns only the default kinds when the env is unset or empty', () => {
    const { resolveCoreResourceKinds } = loadServiceModule(undefined)
    expect(Array.from(resolveCoreResourceKinds({}))).toEqual(['auth.user', 'auth.role'])
    expect(Array.from(resolveCoreResourceKinds({ [EXTRA_ENV]: '' }))).toEqual(['auth.user', 'auth.role'])
  })

  it('appends trimmed extra kinds and ignores empty entries', () => {
    const { resolveCoreResourceKinds } = loadServiceModule(undefined)
    const kinds = resolveCoreResourceKinds({ [EXTRA_ENV]: ' ai_assistant.mcp_tool_call , ,catalog.product,, auth.user ' })
    expect(Array.from(kinds)).toEqual(['auth.user', 'auth.role', 'ai_assistant.mcp_tool_call', 'catalog.product'])
  })
})

describe('access log rotation with extra core kinds', () => {
  it('keeps the default core kinds when the env is unset', async () => {
    const { AccessLogService } = loadServiceModule(undefined)
    const { em, nativeDeleteCalls } = makeFakeEm()
    await new AccessLogService(em as never).log(logPayload)
    expect(nativeDeleteCalls).toHaveLength(2)
    expect(nativeDeleteCalls[0].resourceKind).toEqual({ $in: ['auth.user', 'auth.role'] })
    expect(nativeDeleteCalls[1].resourceKind).toEqual({ $nin: ['auth.user', 'auth.role'] })
  })

  it('rotates extra kinds under core retention', async () => {
    const { AccessLogService } = loadServiceModule('ai_assistant.mcp_tool_call')
    const { em, nativeDeleteCalls } = makeFakeEm()
    const now = 1_750_000_000_000
    jest.spyOn(Date, 'now').mockReturnValue(now)
    await new AccessLogService(em as never).log(logPayload)
    const expectedKinds = ['auth.user', 'auth.role', 'ai_assistant.mcp_tool_call']
    expect(nativeDeleteCalls[0].resourceKind).toEqual({ $in: expectedKinds })
    expect(nativeDeleteCalls[0].createdAt.$lt.getTime()).toBe(now - 7 * 24 * 60 * 60 * 1000)
    expect(nativeDeleteCalls[1].resourceKind).toEqual({ $nin: expectedKinds })
  })
})
