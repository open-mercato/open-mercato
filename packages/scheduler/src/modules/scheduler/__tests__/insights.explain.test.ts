import type { EntityManager } from '@mikro-orm/postgresql'
import type { ExplainLoadContext, ExplainScope } from '@open-mercato/shared/modules/insights/explain'

const findWithDecryptionMock = jest.fn()
const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ error: jest.fn() }) }),
}))

import explainConfig from '../insights.explain'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const SCHEDULE_A = '44444444-4444-4444-8444-444444444444'
const SCHEDULE_B = '55555555-5555-4555-8555-555555555555'

function buildContext(scope: Partial<ExplainScope> = {}): ExplainLoadContext {
  return {
    em: {} as EntityManager,
    resolve: () => undefined,
    scope: { tenantId: TENANT_ID, organizationIds: null, ...scope },
    userId: null,
    locale: 'en',
  }
}

function getResolver() {
  const resolver = explainConfig.causeResolvers?.find((entry) => entry.kind === 'schedule')
  if (!resolver) throw new Error('[internal] missing schedule cause resolver')
  return resolver
}

describe('scheduler insights.explain', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    reportErrorMock.mockReset()
  })

  it('declares the schedule cause resolver behind the jobs view feature', () => {
    expect(explainConfig.version).toBe(1)
    expect(getResolver().requiredFeatures).toEqual(['scheduler.jobs.view'])
  })

  it('resolves organization-bound and tenant-wide schedules in one scoped query', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([
      { id: SCHEDULE_A, name: 'Nightly price sync', organizationId: ORG_A, deletedAt: null },
      { id: SCHEDULE_B, name: 'Tenant cleanup', organizationId: null, deletedAt: new Date() },
    ])
    const details = await getResolver().resolve(buildContext({ organizationIds: [ORG_A] }), [SCHEDULE_A, SCHEDULE_B, SCHEDULE_A])
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    expect(findWithDecryptionMock.mock.calls[0][2]).toEqual({
      id: { $in: [SCHEDULE_A, SCHEDULE_B] },
      tenantId: TENANT_ID,
      $or: [{ organizationId: { $in: [ORG_A] } }, { organizationId: null, scopeType: 'tenant' }],
    })
    expect(details).toEqual([
      {
        kind: 'schedule',
        id: SCHEDULE_A,
        label: 'Nightly price sync',
        href: `/backend/config/scheduled-jobs/${SCHEDULE_A}`,
        organizationId: ORG_A,
      },
      { kind: 'schedule', id: SCHEDULE_B, label: 'Tenant cleanup', href: null, organizationId: null },
    ])
  })

  it('never resolves system schedules outside the tenant for an unrestricted scope', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([])
    await getResolver().resolve(buildContext(), [SCHEDULE_A])
    expect(findWithDecryptionMock.mock.calls[0][2]).toEqual({
      id: { $in: [SCHEDULE_A] },
      tenantId: TENANT_ID,
      $or: [{ organizationId: { $ne: null } }, { organizationId: null, scopeType: 'tenant' }],
    })
  })

  it('skips the query for a denied scope', async () => {
    await expect(getResolver().resolve(buildContext({ organizationIds: [] }), [SCHEDULE_A])).resolves.toEqual([])
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('returns [] and reports when the lookup fails', async () => {
    findWithDecryptionMock.mockRejectedValueOnce(new Error('db down'))
    await expect(getResolver().resolve(buildContext(), [SCHEDULE_A])).resolves.toEqual([])
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), {
      module: 'scheduler',
      code: 'scheduler.insights_cause_failed',
      attributes: { kind: 'schedule' },
    })
  })
})
