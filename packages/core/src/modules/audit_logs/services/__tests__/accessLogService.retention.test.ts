jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  resolveTenantEncryptionService: jest.fn(() => null),
}))

import {
  AccessLogService,
  MIN_ACCESS_LOG_RETENTION_DAYS,
  resolveAccessLogRetentionDays,
} from '../accessLogService'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

function makeFakeEm(resultFactory: (sql: string) => unknown[]) {
  const execute = jest.fn(async (sql: string, _params: unknown[]) => resultFactory(sql))
  const fork = { getConnection: () => ({ execute }) }
  return { em: { fork: jest.fn(() => fork) }, execute }
}

describe('AccessLogService.applyRetention', () => {
  it('reports matching rows without deleting in dry-run mode', async () => {
    const { em, execute } = makeFakeEm(() => [{ matched: '42' }])
    const service = new AccessLogService(em as never)
    const now = new Date('2026-08-21T12:00:00.000Z')

    const result = await service.applyRetention({
      accessClass: 'all',
      batchSize: 500,
      dryRun: true,
      organizationId,
      retentionDays: 90,
      tenantId,
      now,
    })

    expect(result).toEqual(expect.objectContaining({ deleted: 0, dryRun: true, matched: 42 }))
    expect(result.cutoff.toISOString()).toBe('2026-05-23T12:00:00.000Z')
    expect(execute).toHaveBeenCalledTimes(1)
    const [sql, params] = execute.mock.calls[0]!
    expect(sql).toMatch(/select count\(\*\)::bigint/i)
    expect(sql).toMatch(/"tenant_id" = \?/)
    expect(sql).toMatch(/"organization_id" = \?/)
    expect(params).toEqual([result.cutoff, tenantId, organizationId])
  })

  it('deletes one bounded core-resource batch', async () => {
    const deletedRows = [{ id: '1' }, { id: '2' }]
    const { em, execute } = makeFakeEm(() => deletedRows)
    const service = new AccessLogService(em as never)

    const result = await service.applyRetention({
      accessClass: 'core',
      batchSize: 2,
      organizationId,
      retentionDays: 120,
      tenantId,
    })

    expect(result.deleted).toBe(2)
    const [sql, params] = execute.mock.calls[0]!
    expect(sql).toMatch(/with candidates/i)
    expect(sql).toMatch(/"resource_kind" in \(\?, \?\)/)
    expect(sql).toMatch(/order by "created_at" asc, "id" asc/i)
    expect(params.slice(1)).toEqual([tenantId, organizationId, 'auth.user', 'auth.role', 2])
  })

  it('rejects retention below the 90-day floor', async () => {
    const { em, execute } = makeFakeEm(() => [])
    const service = new AccessLogService(em as never)

    await expect(service.applyRetention({
      allScopes: true,
      retentionDays: 89,
    })).rejects.toThrow()
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects an unscoped run unless allScopes is explicit', async () => {
    const { em, execute } = makeFakeEm(() => [])
    const service = new AccessLogService(em as never)

    await expect(service.applyRetention({ retentionDays: 90 })).rejects.toThrow()
    expect(execute).not.toHaveBeenCalled()
  })

  it('allows an explicit all-scope dry run', async () => {
    const { em, execute } = makeFakeEm(() => [{ matched: '5' }])
    const service = new AccessLogService(em as never)

    const result = await service.applyRetention({ allScopes: true, dryRun: true, retentionDays: 90 })

    expect(result.matched).toBe(5)
    const [sql] = execute.mock.calls[0]!
    expect(sql).not.toMatch(/"tenant_id" = \?/)
  })
})

describe('resolveAccessLogRetentionDays', () => {
  const originalRetention = process.env.AUDIT_LOGS_RETENTION_DAYS
  const originalCore = process.env.AUDIT_LOGS_CORE_RETENTION_DAYS
  const originalNonCore = process.env.AUDIT_LOGS_NON_CORE_RETENTION_HOURS

  afterEach(() => {
    if (originalRetention === undefined) delete process.env.AUDIT_LOGS_RETENTION_DAYS
    else process.env.AUDIT_LOGS_RETENTION_DAYS = originalRetention
    if (originalCore === undefined) delete process.env.AUDIT_LOGS_CORE_RETENTION_DAYS
    else process.env.AUDIT_LOGS_CORE_RETENTION_DAYS = originalCore
    if (originalNonCore === undefined) delete process.env.AUDIT_LOGS_NON_CORE_RETENTION_HOURS
    else process.env.AUDIT_LOGS_NON_CORE_RETENTION_HOURS = originalNonCore
  })

  it('defaults to 90 days and floors legacy short values', () => {
    delete process.env.AUDIT_LOGS_RETENTION_DAYS
    process.env.AUDIT_LOGS_CORE_RETENTION_DAYS = '7'
    process.env.AUDIT_LOGS_NON_CORE_RETENTION_HOURS = '8'

    expect(resolveAccessLogRetentionDays('core')).toBe(MIN_ACCESS_LOG_RETENTION_DAYS)
    expect(resolveAccessLogRetentionDays('non_core')).toBe(MIN_ACCESS_LOG_RETENTION_DAYS)
  })

  it('accepts a longer unified retention period', () => {
    process.env.AUDIT_LOGS_RETENTION_DAYS = '180'
    expect(resolveAccessLogRetentionDays('all')).toBe(180)
  })
})
