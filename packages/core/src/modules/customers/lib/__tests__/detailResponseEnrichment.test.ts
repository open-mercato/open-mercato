import { registerResponseEnrichers } from '@open-mercato/shared/lib/crud/enricher-registry'
import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { enrichCustomerDetailResponse } from '../detailResponseEnrichment'

let mockModules = [{ id: 'customers' }, { id: 'example' }]
jest.mock('@open-mercato/shared/lib/modules/registry', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/modules/registry'),
  getModules: () => mockModules,
}))

const getGrantedFeatures = jest.fn()
const context = {
  auth: { sub: 'api_key:caller', tenantId: 'selected-tenant', orgId: 'selected-org' },
  tenantId: 'record-tenant',
  organizationId: 'record-org',
  em: {},
  container: { resolve: (token: string) => token === 'rbacService' ? { getGrantedFeatures } : null },
} as unknown as Parameters<typeof enrichCustomerDetailResponse>[2]

describe('scoped customer detail enrichment', () => {
  beforeEach(() => {
    getGrantedFeatures.mockReset().mockResolvedValue(['example.*'])
    mockModules = [{ id: 'customers' }, { id: 'example' }]
  })
  afterEach(() => registerResponseEnrichers([]))

  it.each(['person', 'company', 'deal'] as const)('projects %s namespaces without replacing native data or mutating the base cache', async (recordKey) => {
    let contribution = 'high'
    const enrichOne = jest.fn(async (record: Record<string, unknown>, enricherContext: EnricherContext) => {
      expect(enricherContext.targetEntity).toBe(`customers.${recordKey}`)
      expect(enricherContext).toMatchObject({ tenantId: 'record-tenant', organizationId: 'record-org', userId: 'api_key:caller' })
      ;(record.profile as Record<string, unknown>).name = 'mutated'
      return { ...record, displayName: 'replaced', _example: { priority: contribution }, _meta: { malicious: true } }
    })
    registerResponseEnrichers([{ moduleId: 'example', enrichers: [{ id: 'example.detail', targetEntity: '*', features: ['example.view'], timeout: 10, enrichOne }] }])
    const base = { [recordKey]: { id: 'record', displayName: 'Native', profile: { name: 'Original' } }, customFields: { tier: 'a' } }
    const first = await enrichCustomerDetailResponse(base, recordKey, context)
    expect(first).toMatchObject({ [recordKey]: { displayName: 'Native', profile: { name: 'Original' }, _example: { priority: 'high' } }, _example: { priority: 'high' } })
    expect(first).not.toHaveProperty('_meta')
    expect(base).not.toHaveProperty('_example')
    expect(base[recordKey].profile.name).toBe('Original')
    contribution = 'critical'
    expect(await enrichCustomerDetailResponse(base, recordKey, context)).toMatchObject({ _example: { priority: 'critical' } })
    getGrantedFeatures.mockResolvedValue([])
    expect(await enrichCustomerDetailResponse(base, recordKey, context)).not.toHaveProperty('_example')
    expect(enrichOne).toHaveBeenCalledTimes(2)
    expect(getGrantedFeatures).toHaveBeenCalledWith('api_key:caller', { tenantId: 'record-tenant', organizationId: 'record-org' })
  })

  it('denies disabled modules even with wildcard grants and fails closed when RBAC is unavailable', async () => {
    const enrichOne = jest.fn(async (record: Record<string, unknown>) => ({ ...record, _example: { priority: 'high' } }))
    registerResponseEnrichers([{ moduleId: 'example', enrichers: [{ id: 'example.detail', targetEntity: '*', features: ['example.view'], enrichOne }] }])
    mockModules = [{ id: 'customers' }]
    getGrantedFeatures.mockResolvedValue(['*'])
    const base = { person: { id: 'record' } }
    expect(await enrichCustomerDetailResponse(base, 'person', context)).toEqual(base)
    mockModules = [{ id: 'customers' }, { id: 'example' }]
    getGrantedFeatures.mockRejectedValue(new Error('[internal] unavailable'))
    expect(await enrichCustomerDetailResponse(base, 'person', context)).toEqual(base)
    expect(enrichOne).not.toHaveBeenCalled()
  })

  it('preserves critical enricher failures', async () => {
    registerResponseEnrichers([{ moduleId: 'example', enrichers: [{ id: 'example.critical', targetEntity: '*', critical: true, timeout: 10, enrichOne: async () => { throw new Error('[internal] failed') } }] }])
    await expect(enrichCustomerDetailResponse({ deal: { id: 'record' } }, 'deal', context)).rejects.toThrow('[internal] failed')
  })
})
