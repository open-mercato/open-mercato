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
const KEY_A = '44444444-4444-4444-8444-444444444444'
const KEY_B = '55555555-5555-4555-8555-555555555555'

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
  const resolver = explainConfig.causeResolvers?.find((entry) => entry.kind === 'api_key')
  if (!resolver) throw new Error('[internal] missing api key cause resolver')
  return resolver
}

describe('api_keys insights.explain', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    reportErrorMock.mockReset()
  })

  it('declares the api key cause resolver behind the api key view feature', () => {
    expect(explainConfig.version).toBe(1)
    expect(getResolver().requiredFeatures).toEqual(['api_keys.view'])
  })

  it('resolves key names in one scoped query without exposing secrets', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([
      { id: KEY_A, name: 'ERP sync', keyPrefix: 'omk_ab12', keyHash: 'secret-hash', organizationId: ORG_A, deletedAt: null },
      { id: KEY_B, name: '', keyPrefix: 'omk_cd34', keyHash: 'secret-hash', organizationId: null, deletedAt: new Date() },
    ])
    const details = await getResolver().resolve(buildContext({ organizationIds: [ORG_A] }), [KEY_A, KEY_B])
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    expect(findWithDecryptionMock.mock.calls[0][2]).toEqual({
      id: { $in: [KEY_A, KEY_B] },
      tenantId: TENANT_ID,
      organizationId: { $in: [ORG_A] },
    })
    expect(details).toEqual([
      { kind: 'api_key', id: KEY_A, label: 'ERP sync', href: '/backend/api-keys', organizationId: ORG_A },
      { kind: 'api_key', id: KEY_B, label: 'omk_cd34', href: null, organizationId: null },
    ])
    expect(JSON.stringify(details)).not.toContain('secret-hash')
  })

  it('skips the query for a denied scope', async () => {
    await expect(getResolver().resolve(buildContext({ organizationIds: [] }), [KEY_A])).resolves.toEqual([])
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('returns [] and reports when the lookup fails', async () => {
    findWithDecryptionMock.mockRejectedValueOnce(new Error('db down'))
    await expect(getResolver().resolve(buildContext(), [KEY_A])).resolves.toEqual([])
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), {
      module: 'api_keys',
      code: 'api_keys.insights_cause_failed',
      attributes: { kind: 'api_key' },
    })
  })
})
