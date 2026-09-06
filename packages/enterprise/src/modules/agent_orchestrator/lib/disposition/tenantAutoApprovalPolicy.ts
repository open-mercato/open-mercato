import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  ACTION_RISK_TIERS,
  DEFAULT_TENANT_AUTO_APPROVAL_POLICY,
  type TenantAutoApprovalPolicy,
} from './autoApprovalPolicy'

const logger = createLogger('agent_orchestrator').child({ component: 'tenant-auto-approval-policy' })

export const AUTO_APPROVAL_CONFIG_MODULE = 'agent_orchestrator'
export const AUTO_APPROVAL_CONFIG_NAME = 'auto_approval_policy'

export const tenantAutoApprovalPolicySchema = z.object({
  enabled: z.boolean(),
  maxAutoApproveRisk: z.enum(ACTION_RISK_TIERS),
})

type ModuleConfigServiceLike = {
  getRecord(
    moduleId: string,
    name: string,
    scope?: { tenantId?: string | null },
  ): Promise<{ value: unknown } | null>
}

function resolveModuleConfig(container: AwilixContainer): ModuleConfigServiceLike | null {
  try {
    return container.resolve('moduleConfigService') as ModuleConfigServiceLike
  } catch {
    return null
  }
}

/**
 * The tenant's standing decision about what may happen without a human.
 *
 * A tenant that has configured nothing gets
 * `DEFAULT_TENANT_AUTO_APPROVAL_POLICY` — enabled, ceiling `medium` — which is
 * the historic behaviour for every action nobody has declared risky, and refuses
 * unattended `high`-risk actions. Reading an unset policy as "allow everything"
 * would make the ceiling opt-in, i.e. absent exactly where it matters.
 *
 * A malformed or unreadable record falls back to that default rather than
 * failing the disposition: losing per-tenant tuning is recoverable, losing the
 * ability to dispose a proposal is not. It is never read as a LOOSER policy than
 * the default — the schema only accepts a complete object, so a partially
 * corrupted record cannot raise the ceiling by omission.
 */
export async function resolveTenantAutoApprovalPolicy(
  container: AwilixContainer,
  tenantId: string | null,
): Promise<TenantAutoApprovalPolicy> {
  const service = resolveModuleConfig(container)
  if (!service) return DEFAULT_TENANT_AUTO_APPROVAL_POLICY
  try {
    const record = await service.getRecord(AUTO_APPROVAL_CONFIG_MODULE, AUTO_APPROVAL_CONFIG_NAME, {
      tenantId,
    })
    if (!record) return DEFAULT_TENANT_AUTO_APPROVAL_POLICY
    const parsed = tenantAutoApprovalPolicySchema.safeParse(record.value)
    if (!parsed.success) {
      logger.warn('stored auto-approval policy is malformed; using the conservative default', {
        tenantId,
      })
      return DEFAULT_TENANT_AUTO_APPROVAL_POLICY
    }
    return parsed.data
  } catch (error) {
    logger.warn('auto-approval policy unreadable; using the conservative default', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    })
    return DEFAULT_TENANT_AUTO_APPROVAL_POLICY
  }
}
