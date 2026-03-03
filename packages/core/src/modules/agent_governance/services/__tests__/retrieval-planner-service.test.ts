import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createRetrievalPlannerService } from '../retrieval-planner-service'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

const mockedFindWithDecryption = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const fakeEm = {} as EntityManager

describe('retrieval-planner-service', () => {
  beforeEach(() => {
    mockedFindWithDecryption.mockReset()
  })

  test('builds deterministic context bundle with bounded slices', async () => {
    mockedFindWithDecryption
      .mockResolvedValueOnce([
        {
          id: 'precedent-2',
          decisionEventId: 'event-2',
          signature: 'sig-b',
          summary: 'Second precedent',
          score: 0.7,
          createdAt: new Date('2026-03-02T10:00:00.000Z'),
        },
        {
          id: 'precedent-1',
          decisionEventId: 'event-1',
          signature: 'sig-a',
          summary: 'First precedent',
          score: 0.9,
          createdAt: new Date('2026-03-03T10:00:00.000Z'),
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: 'why-1',
          reasonType: 'policy',
          summary: 'Policy rationale',
          confidence: 0.9,
          createdAt: new Date('2026-03-03T10:00:00.000Z'),
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: 'neighbor-1',
          entityType: 'agent_governance_policy',
          entityId: 'policy-1',
          relationshipType: 'target',
          decisionEvent: { id: 'event-3' },
          createdAt: new Date('2026-03-03T10:00:00.000Z'),
        },
      ] as never)

    const planner = createRetrievalPlannerService({ em: fakeEm })
    const result = await planner.planContextBundle({
      tenantId: '6d808d45-1a43-4e13-95f2-baa57f4032ee',
      organizationId: '468374f7-4fa2-4fcc-983d-8cebaf2db32d',
      actionType: 'policy.update',
      targetEntity: 'agent_governance_policy',
      targetId: 'policy-1',
      budget: {
        tokenBudget: 800,
        costBudgetUsd: 0.5,
        timeBudgetMs: 1500,
      },
    })

    expect(result.fallbackUsed).toBe(false)
    expect(result.slices.length).toBeGreaterThan(1)
    expect(result.sourceRefs).toEqual(expect.arrayContaining(['decision_event:event-1']))
    expect(result.estimatedTokens).toBeGreaterThan(0)
    expect(result.bundleId).toHaveLength(64)
  })

  test('falls back when retrieval fails', async () => {
    mockedFindWithDecryption.mockRejectedValueOnce(new Error('search unavailable'))

    const planner = createRetrievalPlannerService({ em: fakeEm })
    const result = await planner.planContextBundle({
      tenantId: '6d808d45-1a43-4e13-95f2-baa57f4032ee',
      organizationId: '468374f7-4fa2-4fcc-983d-8cebaf2db32d',
      actionType: 'policy.update',
      targetEntity: 'agent_governance_policy',
      targetId: 'policy-1',
      budget: {
        tokenBudget: 200,
        costBudgetUsd: 0.2,
        timeBudgetMs: 500,
      },
    })

    expect(result.fallbackUsed).toBe(true)
    expect(result.slices[0]?.kind).toBe('fallback')
    expect(result.sourceRefs[0]).toContain('fallback:')
  })

  test('enforces token and cost budget bounds', async () => {
    mockedFindWithDecryption
      .mockResolvedValueOnce([
        {
          id: 'precedent-1',
          decisionEventId: 'event-1',
          signature: 'sig-a',
          summary: 'A'.repeat(1200),
          score: 0.95,
          createdAt: new Date('2026-03-03T10:00:00.000Z'),
        },
        {
          id: 'precedent-2',
          decisionEventId: 'event-2',
          signature: 'sig-b',
          summary: 'B'.repeat(1200),
          score: 0.9,
          createdAt: new Date('2026-03-02T10:00:00.000Z'),
        },
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)

    const planner = createRetrievalPlannerService({ em: fakeEm })
    const result = await planner.planContextBundle({
      tenantId: '6d808d45-1a43-4e13-95f2-baa57f4032ee',
      organizationId: '468374f7-4fa2-4fcc-983d-8cebaf2db32d',
      actionType: 'policy.update',
      targetEntity: 'agent_governance_policy',
      targetId: 'policy-1',
      budget: {
        tokenBudget: 300,
        costBudgetUsd: 0.1,
        timeBudgetMs: 1000,
      },
    })

    expect(result.truncated).toBe(true)
    expect(result.estimatedTokens).toBeLessThanOrEqual(300)
    expect(result.estimatedCostUsd).toBeLessThanOrEqual(0.1)
  })

  test('uses external retrieval provider results when available', async () => {
    const retrieveWithFallback = jest.fn().mockResolvedValue({
      providerId: 'lightrag',
      fallbackUsed: true,
      elapsedMs: 42,
      items: [
        {
          kind: 'precedent',
          title: 'External precedent',
          content: 'External summary',
          sourceRef: 'decision_event:0f4cc352-0f88-4db5-bf2f-e855445e7166',
          score: 0.88,
        },
      ],
    })

    const planner = createRetrievalPlannerService({
      em: fakeEm,
      retrievalAdapterService: {
        retrieveWithFallback,
      },
    })

    const result = await planner.planContextBundle({
      tenantId: '6d808d45-1a43-4e13-95f2-baa57f4032ee',
      organizationId: '468374f7-4fa2-4fcc-983d-8cebaf2db32d',
      actionType: 'policy.update',
      targetEntity: 'agent_governance_policy',
      targetId: 'policy-1',
      providerId: 'lightrag',
      disableProviderFallback: true,
      budget: {
        tokenBudget: 800,
        costBudgetUsd: 0.5,
        timeBudgetMs: 1500,
      },
    })

    expect(result.retrievalProvider).toBe('lightrag')
    expect(result.providerFallbackUsed).toBe(true)
    expect(result.slices[0]?.sourceRef).toBe('decision_event:0f4cc352-0f88-4db5-bf2f-e855445e7166')
    expect(mockedFindWithDecryption).not.toHaveBeenCalled()
    expect(retrieveWithFallback).toHaveBeenCalled()
  })
})
