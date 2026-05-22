import { randomUUID } from 'node:crypto'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getPaymentRecurringRuntime } from '@open-mercato/shared/modules/subscriptions/runtime'
import { emitSubscriptionsEvent } from '../events'
import { syncSubscriptionPlans, type PlanSyncResult } from '../lib/plan-sync'
import { resolveSubscriptionPlanManifest } from '../lib/plan-manifest'
import { syncPlansSchema, type SyncPlansInput } from '../data/validators'
import { loadCredentials } from '../lib/subscription-service'
import type { CredentialsService } from '../../integrations/lib/credentials-service'

type SyncPlansResult = PlanSyncResult & {
  runId: string
  manifestSource: 'builtin' | 'file'
  manifestPath: string | null
}

const syncPlansCommand: CommandHandler<SyncPlansInput, SyncPlansResult> = {
  id: 'subscriptions.plans.sync',
  async execute(rawInput, ctx: CommandRuntimeContext) {
    const parsed = syncPlansSchema.parse(rawInput ?? {})
    const tenantId = ctx.auth?.tenantId ?? null
    const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
    if (!tenantId || !organizationId) {
      throw new Error('subscriptions.plans.sync requires tenant and organization scope')
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const credentialsService = ctx.container.resolve('integrationCredentialsService') as CredentialsService
    const runtime = getPaymentRecurringRuntime('stripe') ?? null
    let credentials: Record<string, unknown> | null = null
    if (runtime) {
      try {
        credentials = await loadCredentials(credentialsService, 'stripe', { tenantId, organizationId })
      } catch (error: unknown) {
        if (process.env.OM_SUBSCRIPTIONS_REQUIRE_STRIPE === '1') throw error
        credentials = null
      }
    }
    const resolvedManifest = await resolveSubscriptionPlanManifest({
      manifestPath: parsed.manifestPath ?? null,
    })
    const result = await syncSubscriptionPlans({
      em,
      scope: { tenantId, organizationId },
      runtime: runtime && credentials ? runtime : null,
      credentials,
      manifest: resolvedManifest.manifest,
    })
    const runId = randomUUID()
    await emitSubscriptionsEvent(
      'subscriptions.plan.synced',
      {
        tenantId,
        organizationId,
        ...result,
        runId,
        manifestSource: resolvedManifest.source,
        manifestPath: resolvedManifest.manifestPath,
      },
    )
    return {
      ...result,
      runId,
      manifestSource: resolvedManifest.source,
      manifestPath: resolvedManifest.manifestPath,
    }
  },
}

registerCommand(syncPlansCommand)

export default syncPlansCommand
