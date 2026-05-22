import { randomUUID } from 'node:crypto'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getPaymentRecurringRuntime } from '@open-mercato/shared/modules/subscriptions/runtime'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { checkoutSchema, type CheckoutInput } from '../data/validators'
import { resolveActivePriceByCode } from '../lib/access-service'
import { ensureMappingForSubscription, loadCredentials } from '../lib/subscription-service'
import { assertSubjectEntityExists, normalizeSubjectEntityType } from '../lib/subject-entity'
import type { CredentialsService } from '../../integrations/lib/credentials-service'

type CheckoutOutput = {
  checkoutUrl: string
  provider: 'stripe'
  subscriptionRequestId: string
  providerCustomerId: string
  providerSessionId: string
}

const PROVIDER_KEY = 'stripe'

const checkoutCommand: CommandHandler<CheckoutInput, CheckoutOutput> = {
  id: 'subscriptions.subscription.checkout',
  async execute(rawInput, ctx: CommandRuntimeContext) {
    const parsed = checkoutSchema.parse(rawInput)
    const normalizedSubjectEntityType = normalizeSubjectEntityType(parsed.subjectEntityType)
    const tenantId = ctx.auth?.tenantId ?? null
    const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(400, { error: 'subscriptions.checkout requires tenant and organization scope' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const credentialsService = ctx.container.resolve('integrationCredentialsService') as CredentialsService
    const queryEngine = ctx.container.resolve('queryEngine') as QueryEngine

    await assertSubjectEntityExists(
      queryEngine,
      { tenantId, organizationId },
      normalizedSubjectEntityType,
      parsed.subjectEntityId,
    )

    const resolved = await resolveActivePriceByCode(em, { tenantId, organizationId }, parsed.priceCode)
    if (!resolved) {
      throw new CrudHttpError(404, { error: `subscriptions.checkout: priceCode "${parsed.priceCode}" not found or inactive` })
    }
    if (!resolved.price.providerPriceRef) {
      throw new CrudHttpError(409, { error: 'subscriptions.checkout: price has not been synced to Stripe yet; run sync-plans first' })
    }

    const runtime = getPaymentRecurringRuntime(PROVIDER_KEY)
    if (!runtime) {
      throw new CrudHttpError(500, { error: 'subscriptions.checkout: stripe runtime is not registered' })
    }
    const credentials = await loadCredentials(credentialsService, PROVIDER_KEY, { tenantId, organizationId })

    const customerRef = await runtime.ensureCustomer({
      scope: { tenantId, organizationId },
      omCustomerId: parsed.subjectEntityId,
      externalAccountId: parsed.externalAccountId,
      email: null,
      name: null,
      credentials,
      metadata: parsed.metadata,
    })

    await ensureMappingForSubscription(em, {
      providerKey: PROVIDER_KEY,
      providerCustomerId: customerRef.providerCustomerId,
      organizationId,
      tenantId,
      externalAccountId: parsed.externalAccountId,
      subjectEntityType: normalizedSubjectEntityType,
      subjectEntityId: parsed.subjectEntityId,
    })

    const subscriptionRequestId = randomUUID()
    const checkout = await runtime.createCheckoutSession({
      scope: { tenantId, organizationId },
      customerRef,
      priceRef: {
        providerPriceRef: resolved.price.providerPriceRef,
        priceCode: resolved.price.code,
      },
      externalAccountId: parsed.externalAccountId,
      successUrl: parsed.successUrl,
      cancelUrl: parsed.cancelUrl,
      allowPromotionCodes: parsed.allowPromotionCodes,
      trialPeriodDays: resolved.price.trialDays ?? null,
      metadata: {
        ...parsed.metadata,
        subscriptionRequestId,
        subjectEntityType: normalizedSubjectEntityType,
        subjectEntityId: parsed.subjectEntityId,
        planCode: resolved.plan.code,
      },
      credentials,
    })

    return {
      checkoutUrl: checkout.checkoutUrl,
      provider: 'stripe',
      subscriptionRequestId,
      providerCustomerId: customerRef.providerCustomerId,
      providerSessionId: checkout.providerSessionId,
    }
  },
}

registerCommand(checkoutCommand)

export default checkoutCommand
