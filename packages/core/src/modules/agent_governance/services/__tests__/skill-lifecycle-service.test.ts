import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createSkillLifecycleService } from '../skill-lifecycle-service'
import type { AgentGovernanceSkill } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

const mockedFindWithDecryption = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const scope = {
  tenantId: 'c7b49cca-4dab-406c-b334-f23d38fac390',
  organizationId: 'fc3f5295-dd7e-4bf2-a286-f36a7c31a90d',
}

function createService() {
  return createSkillLifecycleService({ em: {} as EntityManager })
}

describe('skill-lifecycle-service', () => {
  beforeEach(() => {
    mockedFindWithDecryption.mockReset()
  })

  test('captures skill candidates from decision traces', async () => {
    mockedFindWithDecryption.mockResolvedValueOnce([
      {
        id: '75dbf377-a5f7-4004-8d5a-e4bf63ce9b9d',
        actionType: 'quote.approve',
        targetEntity: 'sales_quote',
        policyId: '22495076-98cb-4ad9-80c3-f25bc935a625',
        riskBandId: 'f1a1a37a-29f9-4c4f-ab18-87f6a3f7749b',
        inputEvidence: ['customer:123', 'pricing:catalog'],
        exceptionIds: ['vp_exception'],
        status: 'success',
      },
      {
        id: '9e42f242-87d4-4334-ad92-1377f17f1ba4',
        actionType: 'quote.approve',
        targetEntity: 'sales_quote',
        policyId: '22495076-98cb-4ad9-80c3-f25bc935a625',
        riskBandId: 'f1a1a37a-29f9-4c4f-ab18-87f6a3f7749b',
        inputEvidence: ['customer:456'],
        exceptionIds: [],
        status: 'failed',
      },
    ] as never)

    const service = createService()
    const result = await service.captureCandidateFromTraces({
      ...scope,
      actionType: 'quote.approve',
      targetEntity: 'sales_quote',
      postmortem: 'Need stronger exception handling',
    })

    expect(result.sourceType).toBe('hybrid')
    expect(result.frameworkJson.intent).toEqual(
      expect.objectContaining({ actionType: 'quote.approve', targetEntity: 'sales_quote' }),
    )
    expect(result.frameworkJson.contextRequirements).toEqual(expect.arrayContaining(['customer']))
    expect(result.evidenceEventIds).toEqual(expect.arrayContaining(['75dbf377-a5f7-4004-8d5a-e4bf63ce9b9d']))
  })

  test('validates skills against historical traces', async () => {
    mockedFindWithDecryption.mockResolvedValueOnce([
      {
        id: 'fcca76ef-2fbf-4226-9494-4d0277f7dbf4',
        actionType: 'quote.approve',
        targetEntity: 'sales_quote',
        policyId: '22495076-98cb-4ad9-80c3-f25bc935a625',
        inputEvidence: ['customer:123', 'pricing:catalog'],
        status: 'success',
      },
      {
        id: '0a934709-98ab-452f-b95c-17a31d08f16f',
        actionType: 'quote.approve',
        targetEntity: 'sales_quote',
        policyId: 'b5bafef8-ad11-4e7d-92ce-b55cb1240c9a',
        inputEvidence: ['customer:123'],
        status: 'success',
      },
    ] as never)

    const skill = {
      id: '9e8ec9ce-8ff6-46cf-aa03-c8a9ce09f95f',
      frameworkJson: {
        intent: {
          actionType: 'quote.approve',
          targetEntity: 'sales_quote',
        },
        policyChecks: [{ id: '22495076-98cb-4ad9-80c3-f25bc935a625' }],
        contextRequirements: ['customer'],
      },
    } as AgentGovernanceSkill

    const service = createService()
    const report = await service.validateSkillDefinition({
      ...scope,
      skill,
      passRateThreshold: 0.4,
    })

    expect(report.sampledEvents).toBe(2)
    expect(report.matchedEvents).toBe(1)
    expect(report.passRate).toBeCloseTo(0.5)
    expect(report.passed).toBe(true)
  })

  test('returns ranked active guidance for run context', async () => {
    mockedFindWithDecryption
      .mockResolvedValueOnce([
        {
          id: '81a53141-4c9f-455f-a95d-a839fbdc1538',
          name: 'quote:sales_quote',
          status: 'active',
          description: 'Quote approval guardrail',
          frameworkJson: {
            intent: {
              actionType: 'quote.approve',
              targetEntity: 'sales_quote',
            },
            validation: { passRate: 0.82 },
          },
        },
        {
          id: 'c34fbf20-2faa-49b3-9107-f4959d1175f5',
          name: 'fallback-skill',
          status: 'active',
          description: 'Fallback',
          frameworkJson: {
            intent: {
              actionType: 'order.update',
              targetEntity: 'sales_order',
            },
          },
        },
      ] as never)

    const service = createService()
    const guidance = await service.listActiveGuidance({
      ...scope,
      actionType: 'quote.approve',
      targetEntity: 'sales_quote',
      limit: 3,
    })

    expect(guidance.length).toBeGreaterThan(0)
    expect(guidance[0]?.skillId).toBe('81a53141-4c9f-455f-a95d-a839fbdc1538')
    expect(guidance[0]?.confidence).toBeGreaterThan(0.8)
  })
})
