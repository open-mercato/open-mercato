import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentGovernancePolicy, AgentGovernanceRiskBand } from '../data/entities'
import { PolicyViolationError } from '../lib/domain-errors'

export type ToolGrantActionClass = 'read' | 'write' | 'irreversible'

export type ToolGrantCheckInput = {
  toolName: string
  tenantId: string
  organizationId: string
  actionClass: ToolGrantActionClass
  policyId?: string | null
  riskScore?: number | null
}

export type ToolGrantDecision = {
  allowed: boolean
  policyId: string | null
  policyMode: 'propose' | 'assist' | 'auto'
  matchedRiskBandId: string | null
}

type ToolGrantServiceDeps = {
  em: EntityManager
}

async function resolvePolicy(
  em: EntityManager,
  input: ToolGrantCheckInput,
): Promise<AgentGovernancePolicy | null> {
  if (input.policyId) {
    const explicitPolicy = await findOneWithDecryption(
      em,
      AgentGovernancePolicy,
      {
        id: input.policyId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        deletedAt: null,
        isActive: true,
      },
      undefined,
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )

    if (!explicitPolicy) {
      throw new PolicyViolationError(
        `Tool ${input.toolName} is blocked because policy ${input.policyId} is not active in this scope.`,
        'TOOL_GRANT_POLICY_NOT_ACTIVE',
      )
    }

    return explicitPolicy
  }

  return findOneWithDecryption(
    em,
    AgentGovernancePolicy,
    {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
      isActive: true,
    },
    { orderBy: { updatedAt: 'DESC' } },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
}

function assertPolicyModeAllowsAction(
  mode: 'propose' | 'assist' | 'auto',
  actionClass: ToolGrantActionClass,
  toolName: string,
): void {
  if (mode === 'propose' && actionClass !== 'read') {
    throw new PolicyViolationError(
      `Tool ${toolName} is blocked because policy mode "propose" only allows read-class tools.`,
      'TOOL_GRANT_POLICY_MODE_BLOCKED',
    )
  }

  if (mode === 'assist' && actionClass === 'irreversible') {
    throw new PolicyViolationError(
      `Tool ${toolName} is blocked because policy mode "assist" disallows irreversible actions.`,
      'TOOL_GRANT_POLICY_MODE_BLOCKED',
    )
  }
}

async function resolveRiskBand(
  em: EntityManager,
  input: ToolGrantCheckInput,
): Promise<AgentGovernanceRiskBand | null> {
  if (typeof input.riskScore !== 'number') {
    return null
  }

  const matchedBands = await findWithDecryption(
    em,
    AgentGovernanceRiskBand,
    {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
      minScore: { $lte: input.riskScore },
      maxScore: { $gte: input.riskScore },
    },
    {
      limit: 1,
      orderBy: [{ isDefault: 'DESC' }, { maxScore: 'ASC' }],
    },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )

  return matchedBands[0] ?? null
}

function assertRiskBandAllowsAction(
  riskBand: AgentGovernanceRiskBand | null,
  actionClass: ToolGrantActionClass,
  toolName: string,
): void {
  if (!riskBand) return
  if (actionClass === 'read') return
  if (!riskBand.failClosed || !riskBand.requiresApproval) return

  throw new PolicyViolationError(
    `Tool ${toolName} is blocked by fail-closed risk band "${riskBand.name}" and requires human checkpoint.`,
    'TOOL_GRANT_RISK_BAND_BLOCKED',
  )
}

export function createToolGrantService(deps: ToolGrantServiceDeps) {
  async function assertToolGrant(input: ToolGrantCheckInput): Promise<ToolGrantDecision> {
    const policy = await resolvePolicy(deps.em, input)
    const policyMode = policy?.defaultMode ?? 'auto'

    assertPolicyModeAllowsAction(policyMode, input.actionClass, input.toolName)

    const riskBand = await resolveRiskBand(deps.em, input)
    assertRiskBandAllowsAction(riskBand, input.actionClass, input.toolName)

    return {
      allowed: true,
      policyId: policy?.id ?? null,
      policyMode,
      matchedRiskBandId: riskBand?.id ?? null,
    }
  }

  return {
    assertToolGrant,
  }
}

export type ToolGrantService = ReturnType<typeof createToolGrantService>
