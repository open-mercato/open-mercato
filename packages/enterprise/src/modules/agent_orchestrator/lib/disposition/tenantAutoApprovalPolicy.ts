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
  return (await readTenantAutoApprovalPolicy(container, tenantId)).policy
}

/**
 * Where the effective policy came from — `'tenant'` when this tenant actually
 * saved one, `'default'` when it is inheriting.
 *
 * The disposition path does not care (a policy is a policy), but the settings
 * screen does: an admin looking at `enabled: true / medium` has to be able to
 * tell "we decided this" from "nobody has decided anything yet", and every
 * fallback arm below — no store, no record, a malformed record, an unreadable
 * one — is honestly `'default'`.
 */
export type TenantAutoApprovalPolicySource = 'tenant' | 'default'

export async function readTenantAutoApprovalPolicy(
  container: AwilixContainer,
  tenantId: string | null,
): Promise<{ policy: TenantAutoApprovalPolicy; source: TenantAutoApprovalPolicySource }> {
  const fallback = {
    policy: DEFAULT_TENANT_AUTO_APPROVAL_POLICY,
    source: 'default' as const,
  }
  const service = resolveModuleConfig(container)
  if (!service) return fallback
  try {
    const record = await service.getRecord(AUTO_APPROVAL_CONFIG_MODULE, AUTO_APPROVAL_CONFIG_NAME, {
      tenantId,
    })
    if (!record) return fallback
    const parsed = tenantAutoApprovalPolicySchema.safeParse(record.value)
    if (!parsed.success) {
      logger.warn('stored auto-approval policy is malformed; using the conservative default', {
        tenantId,
      })
      return fallback
    }
    return { policy: parsed.data, source: 'tenant' }
  } catch (error) {
    logger.warn('auto-approval policy unreadable; using the conservative default', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    })
    return fallback
  }
}
