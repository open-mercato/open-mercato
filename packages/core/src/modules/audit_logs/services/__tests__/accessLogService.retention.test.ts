jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  resolveTenantEncryptionService: jest.fn(() => null),
}))

import type * as AccessLogServiceModule from '../accessLogService'

type ServiceModule = typeof AccessLogServiceModule

const ROTATE_INTERVAL_ENV = 'AUDIT_LOGS_ROTATE_INTERVAL_MS'
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const NOW = 1_750_000_000_000

function loadServiceModule(): ServiceModule {
  let mod: ServiceModule | undefined
  jest.isolateModules(() => {
    process.env[ROTATE_INTERVAL_ENV] = '0'
    mod = require('../accessLogService') as ServiceModule
  })
  if (!mod) throw new Error('[internal] failed to load accessLogService module')
  return mod
}

type DeleteWhere = {
  resourceKind: { $in?: string[]; $nin?: string[] }
  createdAt: { $lt: Date }
}

function makeFakeEm() {
  const deletes: DeleteWhere[] = []
  const fork = {
    getConnection: () => ({
      execute: jest.fn(async () => [{ id: '00000000-0000-4000-8000-000000000001' }]),
    }),
    nativeDelete: jest.fn(async (_entity: unknown, where: DeleteWhere) => {
      deletes.push(where)
      return 0
    }),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
  }
  return { em: { fork: jest.fn(() => fork) }, deletes }
}

function payload(resourceKind: string) {
  return {
    tenantId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    actorUserId: '33333333-3333-4333-8333-333333333333',
    resourceKind,
    resourceId: 'test.process',
    accessType: 'read',
    fields: ['actor_pseudonym'],
    context: { purpose: 'test' },
  }
}

const originalRotateInterval = process.env[ROTATE_INTERVAL_ENV]

afterEach(() => {
  if (originalRotateInterval === undefined) delete process.env[ROTATE_INTERVAL_ENV]
  else process.env[ROTATE_INTERVAL_ENV] = originalRotateInterval
  jest.restoreAllMocks()
})

describe('access log retention of registered resource kinds', () => {
  it('rotates a registered kind under the core retention and every other kind under the non-core retention', async () => {
    const registering = loadServiceModule()
    registering.registerRetainedAccessLogResourceKinds(['test.retained.audit', '', '  ', 'test.retained.audit'])
    const { AccessLogService, listRetainedAccessLogResourceKinds } = loadServiceModule()
    expect(listRetainedAccessLogResourceKinds()).toEqual(expect.arrayContaining(['auth.user', 'auth.role', 'test.retained.audit']))
    expect(listRetainedAccessLogResourceKinds()).not.toContain('')
    jest.spyOn(Date, 'now').mockReturnValue(NOW)
    const { em, deletes } = makeFakeEm()
    await new AccessLogService(em as never).log(payload('example.todo'))
    expect(deletes).toHaveLength(2)
    const [core, nonCore] = deletes
    expect(core.resourceKind.$in).toEqual(expect.arrayContaining(['auth.user', 'auth.role', 'test.retained.audit']))
    expect(core.createdAt.$lt.getTime()).toBe(NOW - 7 * DAY_MS)
    expect(nonCore.resourceKind.$nin).toEqual(expect.arrayContaining(['auth.user', 'auth.role', 'test.retained.audit']))
    expect(nonCore.resourceKind.$nin).not.toContain('example.todo')
    expect(nonCore.createdAt.$lt.getTime()).toBe(NOW - 8 * HOUR_MS)
  })
})
