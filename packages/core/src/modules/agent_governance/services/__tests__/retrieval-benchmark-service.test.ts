import { describe, expect, jest, test } from '@jest/globals'
import { createRetrievalBenchmarkService } from '../retrieval-benchmark-service'

describe('retrieval-benchmark-service', () => {
  test('ranks providers and returns recommendation', async () => {
    const planContextBundle = jest
      .fn()
      .mockImplementation(async (input: { providerId?: string | null }) => {
        if (input.providerId === 'lightrag') {
          return {
            bundleId: 'bundle-a',
            slices: [],
            sourceRefs: ['decision_event:aaa'],
            fallbackUsed: false,
            retrievalProvider: 'lightrag',
            providerFallbackUsed: false,
            estimatedTokens: 120,
            estimatedCostUsd: 0.05,
            elapsedMs: 100,
            truncated: false,
          }
        }

        return {
          bundleId: 'bundle-b',
          slices: [],
          sourceRefs: ['decision_event:bbb'],
          fallbackUsed: false,
          retrievalProvider: 'native',
          providerFallbackUsed: false,
          estimatedTokens: 200,
          estimatedCostUsd: 0.12,
          elapsedMs: 180,
          truncated: false,
        }
      })

    const service = createRetrievalBenchmarkService({
      retrievalPlannerService: { planContextBundle },
      retrievalAdapterService: { listProviders: () => ['native', 'lightrag'] },
    })

    const result = await service.benchmarkProviders({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      cases: [
        {
          actionType: 'policy.update',
          targetEntity: 'agent_governance_policy',
          query: 'policy update',
          expectedSourceRefPrefixes: ['decision_event:'],
        },
      ],
    })

    expect(result.providers).toHaveLength(2)
    expect(result.providers[0]?.providerId).toBe('lightrag')
    expect(result.recommendedProviderId).toBe('lightrag')
    expect(result.recommendationRationale).toContain('Selected lightrag')
  })
})
