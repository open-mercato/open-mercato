import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getPaymentRecurringRuntime } from '@open-mercato/shared/modules/subscriptions/runtime'
import { Subscription } from '../data/entities'
import { mapProviderStatusToAccessState } from '../lib/access-state'
import { loadCredentials } from '../lib/subscription-service'
import { emitSubscriptionsEvent } from '../events'
import type { CredentialsService } from '../../integrations/lib/credentials-service'

export type CancelSubscriptionInput = {
  subscriptionId: string
  atPeriodEnd: boolean
}

export type CancelSubscriptionResult = {
  subscriptionId: string
  providerStatus: string
  accessState: Subscription['accessState']
  cancelAtPeriodEnd: boolean
  cancelledAt: string | null
}

const cancelCommand: CommandHandler<CancelSubscriptionInput, CancelSubscriptionResult> = {
  id: 'subscriptions.subscription.cancel',
  async execute(rawInput, ctx: CommandRuntimeContext) {
    const input = rawInput
    if (!input?.subscriptionId) {
      throw new CrudHttpError(400, { error: 'subscriptions.cancel: subscriptionId is required' })
    }
    const tenantId = ctx.auth?.tenantId ?? null
    const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(400, { error: 'subscriptions.cancel requires tenant and organization scope' })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const credentialsService = ctx.container.resolve('integrationCredentialsService') as CredentialsService

    const subscription = await findOneWithDecryption(
      em,
      Subscription,
      { id: input.subscriptionId, tenantId, organizationId, deletedAt: null },
      undefined,
      { tenantId, organizationId },
    )
    if (!subscription) {
      throw new CrudHttpError(404, { error: 'subscriptions.cancel: subscription not found' })
    }
    if (!subscription.providerSubscriptionId) {
      throw new CrudHttpError(409, { error: 'subscriptions.cancel: subscription has no provider subscription id yet' })
    }

    const runtime = getPaymentRecurringRuntime(subscription.providerKey)
    if (!runtime) {
      throw new CrudHttpError(500, { error: `subscriptions.cancel: no recurring runtime for provider "${subscription.providerKey}"` })
    }
    const credentials = await loadCredentials(credentialsService, subscription.providerKey, { tenantId, organizationId })

    const cancelResult = await runtime.cancelSubscription({
      scope: { tenantId, organizationId },
      providerSubscriptionId: subscription.providerSubscriptionId,
      atPeriodEnd: input.atPeriodEnd !== false,
      credentials,
    })

    const previousAccess = subscription.accessState
    subscription.providerStatus = cancelResult.providerStatus
    subscription.cancelAtPeriodEnd = cancelResult.cancelAtPeriodEnd
    subscription.cancelledAt = cancelResult.cancelledAt ?? subscription.cancelledAt ?? null
    subscription.accessState = mapProviderStatusToAccessState(cancelResult.providerStatus)
    await em.flush()

    if (previousAccess !== subscription.accessState) {
      await emitSubscriptionsEvent(
        'subscriptions.access.changed',
        {
          tenantId,
          organizationId,
          subscriptionId: subscription.id,
          externalAccountId: subscription.externalAccountId,
          accessState: subscription.accessState,
          previousAccessState: previousAccess,
          providerStatus: subscription.providerStatus,
        },
      )
    }

    return {
      subscriptionId: subscription.id,
      providerStatus: subscription.providerStatus,
      accessState: subscription.accessState,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      cancelledAt: subscription.cancelledAt ? subscription.cancelledAt.toISOString() : null,
    }
  },
}

registerCommand(cancelCommand)

export default cancelCommand
