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
const RULE_A = '44444444-4444-4444-8444-444444444444'
const RULE_B = '55555555-5555-4555-8555-555555555555'

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
  const resolver = explainConfig.causeResolvers?.find((entry) => entry.kind === 'business_rule')
  if (!resolver) throw new Error('[internal] missing business rule cause resolver')
  return resolver
}

describe('business_rules insights.explain', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    reportErrorMock.mockReset()
  })

  it('declares the business rule cause resolver behind the rules view feature', () => {
    expect(explainConfig.version).toBe(1)
    expect(getResolver().requiredFeatures).toEqual(['business_rules.view'])
  })

  it('resolves rule ids in one scoped query', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([
      { id: RULE_A, ruleId: 'CREDIT_LIMIT', ruleName: 'Credit limit check', organizationId: ORG_A, deletedAt: null },
      { id: RULE_B, ruleId: 'LEGACY', ruleName: '', organizationId: ORG_A, deletedAt: new Date() },
    ])
    const details = await getResolver().resolve(buildContext({ organizationIds: [ORG_A] }), [RULE_A, RULE_B, RULE_A, 'x'])
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    const [, , where, , scope] = findWithDecryptionMock.mock.calls[0]
    expect(where).toEqual({ id: { $in: [RULE_A, RULE_B] }, tenantId: TENANT_ID, organizationId: { $in: [ORG_A] } })
    expect(scope).toEqual({ tenantId: TENANT_ID, organizationId: ORG_A })
    expect(details).toEqual([
      { kind: 'business_rule', id: RULE_A, label: 'Credit limit check', href: `/backend/rules/${RULE_A}`, organizationId: ORG_A },
      { kind: 'business_rule', id: RULE_B, label: 'LEGACY', href: null, organizationId: ORG_A },
    ])
  })

  it('queries tenant-wide for an unrestricted scope', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([])
    await getResolver().resolve(buildContext(), [RULE_A])
    expect(findWithDecryptionMock.mock.calls[0][2]).toEqual({ id: { $in: [RULE_A] }, tenantId: TENANT_ID })
  })

  it('skips the query for a denied scope or no valid ids', async () => {
    await expect(getResolver().resolve(buildContext({ organizationIds: [] }), [RULE_A])).resolves.toEqual([])
    await expect(getResolver().resolve(buildContext(), ['__business_rule_x__'])).resolves.toEqual([])
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('returns [] and reports when the lookup fails', async () => {
    findWithDecryptionMock.mockRejectedValueOnce(new Error('db down'))
    await expect(getResolver().resolve(buildContext(), [RULE_A])).resolves.toEqual([])
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), {
      module: 'business_rules',
      code: 'business_rules.insights_cause_failed',
      attributes: { kind: 'business_rule' },
    })
  })
})
