import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getPaymentRecurringRuntime } from '@open-mercato/shared/modules/subscriptions/runtime'
import { Subscription } from '../data/entities'
import { applySnapshotToSubscription, loadCredentials } from '../lib/subscription-service'
import { emitSubscriptionsEvent } from '../events'
import { refreshSubscriptionSchema } from '../data/validators'
import type { CredentialsService } from '../../integrations/lib/credentials-service'

type RefreshResult = {
  subscriptionId: string
  changed: boolean
  accessState: Subscription['accessState']
  providerStatus: string
}

const refreshCommand: CommandHandler<{ subscriptionId: string }, RefreshResult> = {
  id: 'subscriptions.subscription.refresh',
  async execute(rawInput, ctx: CommandRuntimeContext) {
    const parsed = refreshSubscriptionSchema.parse(rawInput)
    const tenantId = ctx.auth?.tenantId ?? null
    const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(400, { error: 'subscriptions.refresh requires tenant and organization scope' })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const credentialsService = ctx.container.resolve('integrationCredentialsService') as CredentialsService

    const subscription = await findOneWithDecryption(
      em,
      Subscription,
      { id: parsed.subscriptionId, tenantId, organizationId, deletedAt: null },
      undefined,
      { tenantId, organizationId },
    )
    if (!subscription) {
      throw new CrudHttpError(404, { error: 'subscriptions.refresh: subscription not found' })
    }
    if (!subscription.providerSubscriptionId) {
      return {
        subscriptionId: subscription.id,
        changed: false,
        accessState: subscription.accessState,
        providerStatus: subscription.providerStatus,
      }
    }

    const runtime = getPaymentRecurringRuntime(subscription.providerKey)
    if (!runtime) {
      throw new CrudHttpError(500, { error: `subscriptions.refresh: no recurring runtime for provider "${subscription.providerKey}"` })
    }
    const credentials = await loadCredentials(credentialsService, subscription.providerKey, { tenantId, organizationId })

    const snapshot = await runtime.fetchSubscriptionSnapshot({
      scope: { tenantId, organizationId },
      providerSubscriptionId: subscription.providerSubscriptionId,
      credentials,
    })
    if (!snapshot) {
      return {
        subscriptionId: subscription.id,
        changed: false,
        accessState: subscription.accessState,
        providerStatus: subscription.providerStatus,
      }
    }

    const previous = subscription.accessState
    const result = await applySnapshotToSubscription(em, subscription, snapshot, { authoritative: true })
    await em.flush()

    if (result.changed && previous !== subscription.accessState) {
      await emitSubscriptionsEvent(
        'subscriptions.access.changed',
        {
          tenantId,
          organizationId,
          subscriptionId: subscription.id,
          externalAccountId: subscription.externalAccountId,
          accessState: subscription.accessState,
          previousAccessState: previous,
          providerStatus: subscription.providerStatus,
        },
      )
    }

    return {
      subscriptionId: subscription.id,
      changed: result.changed,
      accessState: subscription.accessState,
      providerStatus: subscription.providerStatus,
    }
  },
}

registerCommand(refreshCommand)

export default refreshCommand
