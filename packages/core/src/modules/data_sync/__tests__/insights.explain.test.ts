import type { EntityManager } from '@mikro-orm/postgresql'
import type { ExplainLoadContext, ExplainScope } from '@open-mercato/shared/modules/insights/explain'

const findWithDecryptionMock = jest.fn()
const getIntegrationMock = jest.fn()
const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/modules/integrations/types', () => ({
  getIntegration: (...args: unknown[]) => getIntegrationMock(...args),
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
const RUN_A = '44444444-4444-4444-8444-444444444444'
const RUN_B = '55555555-5555-4555-8555-555555555555'

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
  const resolver = explainConfig.causeResolvers?.find((entry) => entry.kind === 'sync_run')
  if (!resolver) throw new Error('[internal] missing sync run cause resolver')
  return resolver
}

describe('data_sync insights.explain', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    getIntegrationMock.mockReset()
    reportErrorMock.mockReset()
  })

  it('declares the sync run cause resolver behind the data sync view feature', () => {
    expect(explainConfig.version).toBe(1)
    expect(getResolver().requiredFeatures).toEqual(['data_sync.view'])
  })

  it('resolves runs in one scoped query and labels them with the integration title', async () => {
    getIntegrationMock.mockImplementation((id: string) => (id === 'akeneo' ? { id, title: 'Akeneo PIM' } : undefined))
    findWithDecryptionMock.mockResolvedValueOnce([
      { id: RUN_A, integrationId: 'akeneo', entityType: 'catalog.product', organizationId: ORG_A, deletedAt: null },
      { id: RUN_B, integrationId: 'removed_provider', entityType: '', organizationId: ORG_A, deletedAt: new Date() },
    ])
    const details = await getResolver().resolve(buildContext({ organizationIds: [ORG_A] }), [RUN_A, RUN_B])
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    expect(findWithDecryptionMock.mock.calls[0][2]).toEqual({
      id: { $in: [RUN_A, RUN_B] },
      tenantId: TENANT_ID,
      organizationId: { $in: [ORG_A] },
    })
    expect(details).toEqual([
      {
        kind: 'sync_run',
        id: RUN_A,
        label: 'Akeneo PIM (catalog.product)',
        href: `/backend/data-sync/runs/${RUN_A}`,
        organizationId: ORG_A,
      },
      { kind: 'sync_run', id: RUN_B, label: 'removed_provider', href: null, organizationId: ORG_A },
    ])
  })

  it('skips the query for a denied scope', async () => {
    await expect(getResolver().resolve(buildContext({ organizationIds: [] }), [RUN_A])).resolves.toEqual([])
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('returns [] and reports when the lookup fails', async () => {
    findWithDecryptionMock.mockRejectedValueOnce(new Error('db down'))
    await expect(getResolver().resolve(buildContext(), [RUN_A])).resolves.toEqual([])
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), {
      module: 'data_sync',
      code: 'data_sync.insights_cause_failed',
      attributes: { kind: 'sync_run' },
    })
  })
})
