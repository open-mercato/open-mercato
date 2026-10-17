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

import explainConfig, { DICTIONARY_ENTRY_REFERENCE_KIND } from '../insights.explain'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ENTRY_A = '44444444-4444-4444-8444-444444444444'
const DICTIONARY_ID = '55555555-5555-4555-8555-555555555555'

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
  const resolver = explainConfig.referenceResolvers?.find((entry) => entry.kind === DICTIONARY_ENTRY_REFERENCE_KIND)
  if (!resolver) throw new Error('[internal] missing dictionary entry reference resolver')
  return resolver
}

describe('dictionaries insights.explain', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    reportErrorMock.mockReset()
  })

  it('declares the dictionary entry reference resolver behind the dictionary view feature', () => {
    expect(explainConfig.version).toBe(1)
    expect(DICTIONARY_ENTRY_REFERENCE_KIND).toBe('dictionary.entry')
    expect(getResolver().requiredFeatures).toEqual(['dictionaries.view'])
  })

  it('resolves entry labels in one scoped query', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([
      { id: ENTRY_A, value: 'confirmed', label: 'Confirmed', organizationId: ORG_A, dictionary: { id: DICTIONARY_ID } },
    ])
    const details = await getResolver().resolve(buildContext({ organizationIds: [ORG_A] }), [ENTRY_A, ENTRY_A, 'confirmed'])
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    expect(findWithDecryptionMock.mock.calls[0][2]).toEqual({
      id: { $in: [ENTRY_A] },
      tenantId: TENANT_ID,
      organizationId: { $in: [ORG_A] },
    })
    expect(details).toEqual([
      {
        kind: 'dictionary.entry',
        id: ENTRY_A,
        label: 'Confirmed',
        href: null,
        organizationId: ORG_A,
        facts: { value: 'confirmed', dictionaryId: DICTIONARY_ID },
      },
    ])
  })

  it('skips the query for a denied scope', async () => {
    await expect(getResolver().resolve(buildContext({ organizationIds: [] }), [ENTRY_A])).resolves.toEqual([])
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('returns [] and reports when the lookup fails', async () => {
    findWithDecryptionMock.mockRejectedValueOnce(new Error('db down'))
    await expect(getResolver().resolve(buildContext(), [ENTRY_A])).resolves.toEqual([])
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), {
      module: 'dictionaries',
      code: 'dictionaries.insights_reference_failed',
      attributes: { kind: 'dictionary.entry' },
    })
  })
})
