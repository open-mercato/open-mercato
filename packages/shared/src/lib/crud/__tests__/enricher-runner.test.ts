import type { EnricherContext, ResponseEnricher } from '../response-enricher'
import { registerResponseEnrichers } from '../enricher-registry'
import { applyResponseEnricherToRecord } from '../enricher-runner'

describe('enricher runner', () => {
  it('partitions wildcard read-through cache entries by concrete entity', async () => {
    const cacheEntries = new Map<string, unknown>()
    const cache = {
      get: jest.fn(async (key: string) => cacheEntries.get(key)),
      set: jest.fn(async (key: string, value: unknown) => {
        cacheEntries.set(key, value)
      }),
    }
    const enrichOne = jest.fn(
      async (record: Record<string, unknown>, context: EnricherContext) => ({
        ...record,
        enrichedFrom: context.targetEntity,
      }),
    )
    const enricher: ResponseEnricher<
      Record<string, unknown>,
      { enrichedFrom: string | undefined }
    > = {
      id: 'test.wildcard-cache',
      targetEntity: '*',
      timeout: 10,
      cache: { strategy: 'read-through', ttl: 60_000 },
      enrichOne,
    }
    registerResponseEnrichers([{ moduleId: 'test', enrichers: [enricher] }])

    const context: EnricherContext = {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      em: {},
      container: { resolve: () => cache },
    }

    const personResult = await applyResponseEnricherToRecord(
      { id: 'shared-id' },
      'customers.person',
      context,
    )
    const orderResult = await applyResponseEnricherToRecord(
      { id: 'shared-id' },
      'sales.order',
      context,
    )

    expect(personResult.record).toMatchObject({ enrichedFrom: 'customers.person' })
    expect(orderResult.record).toMatchObject({ enrichedFrom: 'sales.order' })
    expect(enrichOne).toHaveBeenCalledTimes(2)
    expect(Array.from(cacheEntries.keys())).toEqual([
      expect.stringContaining('entity:customers.person'),
      expect.stringContaining('entity:sales.order'),
    ])
  })
})
