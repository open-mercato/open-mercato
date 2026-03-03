import { afterEach, describe, expect, jest, test } from '@jest/globals'
import { createRetrievalAdapterService } from '../retrieval-adapter-service'

function createJsonResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  } as unknown as Response
}

describe('retrieval-adapter-service', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    delete process.env.AGENT_GOVERNANCE_RETRIEVAL_PROVIDER
    delete process.env.AGENT_GOVERNANCE_RETRIEVAL_FALLBACK_PROVIDER
    delete process.env.AGENT_GOVERNANCE_LIGHTRAG_URL
    delete process.env.AGENT_GOVERNANCE_LIGHTRAG_PATH
    delete process.env.AGENT_GOVERNANCE_LIGHTRAG_API_KEY
    delete process.env.AGENT_GOVERNANCE_GRAPHRAG_RS_URL
    delete process.env.AGENT_GOVERNANCE_GRAPHRAG_RS_PATH
    delete process.env.AGENT_GOVERNANCE_GRAPHRAG_RS_API_KEY
  })

  test('lists native and external providers', () => {
    const service = createRetrievalAdapterService()
    expect(service.listProviders()).toEqual(['native', 'graphrag_rs', 'lightrag'])
  })

  test('returns null when configured provider is unavailable', async () => {
    const service = createRetrievalAdapterService({ providerId: 'lightrag' })
    const result = await service.retrieveWithFallback({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      actionType: 'policy.update',
      targetEntity: 'agent_governance_policy',
      targetId: 'policy-1',
      query: 'policy update',
      signature: null,
      limit: 5,
    })

    expect(result).toBeNull()
  })

  test('retrieves normalized items from lightrag adapter', async () => {
    process.env.AGENT_GOVERNANCE_LIGHTRAG_URL = 'https://lightrag.local'
    process.env.AGENT_GOVERNANCE_RETRIEVAL_PROVIDER = 'lightrag'

    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          items: [
            {
              decision_event_id: '7ff2f8d8-1255-4cda-863c-3bccacbe87c9',
              summary: 'Policy precedent',
              score: 0.92,
              kind: 'precedent',
            },
          ],
        }),
      )

    const service = createRetrievalAdapterService()
    const result = await service.retrieveWithFallback({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      actionType: 'policy.update',
      targetEntity: 'agent_governance_policy',
      targetId: 'policy-1',
      query: 'policy update',
      signature: null,
      limit: 5,
    })

    expect(result).not.toBeNull()
    expect(result?.providerId).toBe('lightrag')
    expect(result?.fallbackUsed).toBe(false)
    expect(result?.items[0]?.sourceRef).toBe('decision_event:7ff2f8d8-1255-4cda-863c-3bccacbe87c9')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('falls back to graphrag_rs when preferred provider fails', async () => {
    process.env.AGENT_GOVERNANCE_LIGHTRAG_URL = 'https://lightrag.local'
    process.env.AGENT_GOVERNANCE_GRAPHRAG_RS_URL = 'https://graphrag.local'

    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('upstream timeout'))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          results: [
            {
              source_ref: 'decision_event:f8ca52e5-c53d-468a-a932-185f029a18de',
              content: 'Fallback precedent',
              confidence: 0.8,
            },
          ],
        }),
      )

    const service = createRetrievalAdapterService({
      providerId: 'lightrag',
      fallbackProviderId: 'graphrag_rs',
    })

    const result = await service.retrieveWithFallback({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      actionType: 'policy.update',
      targetEntity: 'agent_governance_policy',
      targetId: 'policy-1',
      query: 'policy update',
      signature: null,
      limit: 5,
    })

    expect(result).not.toBeNull()
    expect(result?.providerId).toBe('graphrag_rs')
    expect(result?.fallbackUsed).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
