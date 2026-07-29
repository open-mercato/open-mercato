import { createHash } from 'node:crypto'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { resolveBusinessRuleDiscoveryCache } from '@open-mercato/core/modules/business_rules/lib/rule-engine'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { seedExampleWorkflows } from './lib/seeds'
import { WORKFLOW_DEFINITION_METRIC_ROLLUP_INTERVAL } from './lib/metrics/rollup-schedule'

const logger = createLogger('workflows')

type SchedulerServiceLike = {
  register: (registration: {
    id: string
    name: string
    description?: string
    scopeType: 'system' | 'organization' | 'tenant'
    organizationId?: string
    tenantId?: string
    scheduleType: 'cron' | 'interval'
    scheduleValue: string
    timezone?: string
    targetType: 'queue'
    targetQueue: string
    targetPayload?: Record<string, unknown>
    sourceType?: string
    sourceModule?: string
    isEnabled?: boolean
  }) => Promise<void>
}

/**
 * `scheduled_jobs.id` is a uuid column, so a module-owned schedule's stable
 * registration key must be hashed into a uuid rather than used verbatim — this
 * keeps `schedulerService.register()` an idempotent upsert across re-runs of
 * `seedDefaults` instead of trying to insert a raw string into the uuid PK.
 */
function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Register the per-organization KPI rollup tick (spec §8.5).
 *
 * Per ORGANIZATION rather than one system-wide tick that enumerates tenants:
 * the pass would otherwise need an unscoped read to discover which
 * organizations exist, and this module's rule is that every query carries both
 * scope columns. One schedule row per organization is the price of that.
 *
 * Best-effort in both directions: `@open-mercato/scheduler` is an optional peer
 * (no registration in the container ⇒ silent no-op), and a failure to register
 * must never abort tenant setup — the read API live-computes when no rollup row
 * exists, so a missing schedule degrades freshness, not correctness.
 */
async function ensureMetricRollupSchedule(ctx: {
  container: { resolve: (name: string) => unknown; hasRegistration?: (name: string) => boolean }
  tenantId: string
  organizationId: string
}): Promise<void> {
  const cradle = ctx.container as { hasRegistration?: (name: string) => boolean }
  if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) return
  try {
    const schedulerService = ctx.container.resolve('schedulerService') as SchedulerServiceLike
    await schedulerService.register({
      id: stableScheduleUuid(`workflows:definition-metric-rollup:${ctx.organizationId}`),
      name: 'Workflow definition metric rollup',
      description:
        'Recomputes per-definition run, success-rate, duration-percentile and task-SLA KPIs into workflow_definition_metric_rollups.',
      scopeType: 'organization',
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      scheduleType: 'interval',
      scheduleValue: WORKFLOW_DEFINITION_METRIC_ROLLUP_INTERVAL,
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: 'workflow-definition-metric-rollup',
      targetPayload: { scope: { tenantId: ctx.tenantId, organizationId: ctx.organizationId } },
      sourceType: 'module',
      sourceModule: 'workflows',
      isEnabled: true,
    })
  } catch (error) {
    logger.warn('[internal] workflows: failed to register the metric-rollup schedule', { err: error })
  }
}

export const setup: ModuleSetupConfig = {
  seedDefaults: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    const cache = resolveBusinessRuleDiscoveryCache(ctx.container.resolve.bind(ctx.container))
    await seedExampleWorkflows(ctx.em, scope, { cache })
    await ensureMetricRollupSchedule({
      container: ctx.container as never,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  },

  /**
   * Portal grants for the §6.4 portal task surface.
   *
   * Declared HERE rather than in `customer_accounts` because a module ships its
   * own portal features the same way it ships its own backoffice ones —
   * `syncDefaultCustomerRoleAcls` collects `defaultCustomerRoleFeatures` from
   * every enabled module and merges them into the seeded customer roles.
   * Workflows is the first shipped consumer of that seam.
   *
   * `portal_admin` is deliberately absent: it already carries `portal.*`, and a
   * wildcard is exactly what the portal branch of the predicate refuses to treat
   * as ownership. Granting it explicitly would suggest the wildcard means
   * something it does not.
   *
   * Two rollout caveats, neither a bug:
   * - The merge is additive into EXISTING roles and runs during tenant setup,
   *   so an already-provisioned tenant picks these up only after
   *   `mercato customer_accounts sync-customer-role-acls`.
   * - `CustomerRbacService` caches ACLs for 5 minutes, so a fresh grant is not
   *   immediately visible to a signed-in portal user.
   */
  defaultCustomerRoleFeatures: {
    buyer: ['portal.tasks.view', 'portal.tasks.complete'],
    viewer: ['portal.tasks.view'],
  },

  defaultRoleFeatures: {
    // `workflows.*` already grants every concrete id, including the spec §8.4
    // recovery features `workflows.instances.rerun_step` and
    // `workflows.instances.bulk_ops` and the spec §8.5 ops feature
    // `workflows.metrics.view`. Existing tenants pick up newly declared
    // features only after `yarn mercato auth sync-role-acls`.
    admin: ['workflows.*'],
    employee: [
      'workflows.view',
      'workflows.view_tasks',
      'workflows.tasks.view',
      'workflows.tasks.claim',
      'workflows.tasks.complete',
      'workflows.instances.view',
    ],
  },
}

export default setup
