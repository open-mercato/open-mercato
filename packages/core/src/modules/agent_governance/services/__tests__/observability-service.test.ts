import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createObservabilityService } from '../observability-service'
import {
  AgentGovernanceApprovalTask,
  AgentGovernanceDecisionEvent,
  AgentGovernanceDecisionWhyLink,
  AgentGovernanceRun,
  AgentGovernanceSkill,
  AgentGovernanceSkillVersion,
} from '../../data/entities'

const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

describe('observability-service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('computes skill guidance impact delta and low-noise digest routing', async () => {
    const em = {
      count: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
        if (entity === AgentGovernanceRun) {
          if (where.status === undefined) return 10
          if (where.status === 'queued') return 0
          if (where.status === 'running') return 0
          if (where.status === 'checkpoint') return 100
          if (where.status === 'paused') return 0
          if (where.status === 'failed') {
            return where.updatedAt ? 0 : 1
          }
          if (where.status === 'completed') return 9
          if (where.status === 'terminated') return 0
        }
        if (entity === AgentGovernanceApprovalTask) return 0
        if (entity === AgentGovernanceDecisionEvent) {
          if (where.errorCode) return 0
          return 20
        }
        if (entity === AgentGovernanceDecisionWhyLink) return 10
        if (entity === AgentGovernanceSkill) {
          if (where.status === undefined) return 3
          if (where.status === 'draft') return 1
          if (where.status === 'validated') return 1
          if (where.status === 'active') return 1
          if (where.status === 'deprecated') return 0
        }
        if (entity === AgentGovernanceSkillVersion) return 1
        return 0
      }),
    }

    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === AgentGovernanceApprovalTask) {
        return []
      }

      if (entity === AgentGovernanceDecisionEvent) {
        return Array.from({ length: 20 }).map((_, index) => ({
          inputEvidence: [`ctx:${index}`],
          writeSet: { ok: true },
        }))
      }

      if (entity === AgentGovernanceRun) {
        return [
          { status: 'completed', inputContext: { activeSkills: [{ id: 'skill-1' }] } },
          { status: 'completed', inputContext: { activeSkills: [{ id: 'skill-2' }] } },
          { status: 'failed', inputContext: { activeSkills: [{ id: 'skill-1' }] } },
          { status: 'completed', inputContext: null },
          { status: 'failed', inputContext: null },
        ]
      }

      return []
    })

    const service = createObservabilityService({ em: em as unknown as EntityManager })

    const metrics = await service.getMetrics({ tenantId: 'tenant-1', organizationId: 'org-1' })

    expect(metrics.learning.skillGuidanceImpact30d).toEqual(
      expect.objectContaining({
        terminalRunsWithSkills: 3,
        terminalRunsWithoutSkills: 2,
      }),
    )
    expect(metrics.learning.skillGuidanceImpact30d.successRateDelta).toBeCloseTo((2 / 3) - (1 / 2), 6)

    expect(metrics.operations.alertRouting).toEqual(
      expect.objectContaining({
        severity: 'low',
        route: 'governance_admins',
        digestRecommended: true,
      }),
    )
  })

  test('routes high severity anomalies to operators', async () => {
    const em = {
      count: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
        if (entity === AgentGovernanceRun) {
          if (where.status === undefined) return 2
          if (where.status === 'queued') return 0
          if (where.status === 'running') return 0
          if (where.status === 'checkpoint') return 0
          if (where.status === 'paused') return 0
          if (where.status === 'failed') {
            return where.updatedAt ? 7 : 7
          }
          if (where.status === 'completed') return 0
          if (where.status === 'terminated') return 0
        }
        if (entity === AgentGovernanceApprovalTask) return 0
        if (entity === AgentGovernanceDecisionEvent) {
          if (where.errorCode) return 11
          return 2
        }
        if (entity === AgentGovernanceDecisionWhyLink) return 0
        if (entity === AgentGovernanceSkill) {
          if (where.status === undefined) return 0
          return 0
        }
        if (entity === AgentGovernanceSkillVersion) return 0
        return 0
      }),
    }

    mockFindWithDecryption.mockImplementation(async (_em: unknown, _entity: unknown) => [])

    const service = createObservabilityService({ em: em as unknown as EntityManager })
    const metrics = await service.getMetrics({ tenantId: 'tenant-1', organizationId: 'org-1' })

    expect(metrics.operations.alertRouting).toEqual(
      expect.objectContaining({
        severity: 'high',
        route: 'operators',
        digestRecommended: false,
      }),
    )
  })
})
