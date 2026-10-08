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

import explainConfig, { AUTH_USER_REFERENCE_KIND } from '../insights.explain'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const USER_A = '44444444-4444-4444-8444-444444444444'
const USER_B = '55555555-5555-4555-8555-555555555555'

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
  const resolver = explainConfig.referenceResolvers?.find((entry) => entry.kind === AUTH_USER_REFERENCE_KIND)
  if (!resolver) throw new Error('[internal] missing auth user reference resolver')
  return resolver
}

describe('auth insights.explain', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    reportErrorMock.mockReset()
  })

  it('declares the user reference resolver behind the user list feature', () => {
    expect(explainConfig.version).toBe(1)
    expect(AUTH_USER_REFERENCE_KIND).toBe('auth.user')
    expect(getResolver().requiredFeatures).toEqual(['auth.users.list'])
  })

  it('returns display names only and never falls back to the email', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([
      { id: USER_A, name: '  Grace Hopper ', email: 'grace@example.com', organizationId: ORG_A },
      { id: USER_B, name: null, email: 'no-name@example.com', organizationId: null },
    ])
    const details = await getResolver().resolve(buildContext({ organizationIds: [ORG_A] }), [USER_A, USER_B, USER_A])
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    expect(findWithDecryptionMock.mock.calls[0][2]).toEqual({
      id: { $in: [USER_A, USER_B] },
      tenantId: TENANT_ID,
      deletedAt: null,
      $or: [{ organizationId: null }, { organizationId: { $in: [ORG_A] } }],
    })
    expect(details).toEqual([
      { kind: 'auth.user', id: USER_A, label: 'Grace Hopper', href: null, organizationId: ORG_A },
      { kind: 'auth.user', id: USER_B, label: null, href: null, organizationId: null },
    ])
    expect(JSON.stringify(details)).not.toContain('@example.com')
  })

  it('queries tenant-wide for an unrestricted scope', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([])
    await getResolver().resolve(buildContext(), [USER_A])
    expect(findWithDecryptionMock.mock.calls[0][2]).toEqual({ id: { $in: [USER_A] }, tenantId: TENANT_ID, deletedAt: null })
  })

  it('skips the query for a denied scope or non-user ids', async () => {
    await expect(getResolver().resolve(buildContext({ organizationIds: [] }), [USER_A])).resolves.toEqual([])
    await expect(getResolver().resolve(buildContext(), ['api_key:abc'])).resolves.toEqual([])
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('returns [] and reports when the lookup fails', async () => {
    findWithDecryptionMock.mockRejectedValueOnce(new Error('db down'))
    await expect(getResolver().resolve(buildContext(), [USER_A])).resolves.toEqual([])
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), {
      module: 'auth',
      code: 'auth.insights_reference_failed',
      attributes: { kind: 'auth.user' },
    })
  })
})
