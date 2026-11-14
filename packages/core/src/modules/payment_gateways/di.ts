import { asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CredentialsService } from '../integrations/lib/credentials-service'
import type { IntegrationLogService } from '../integrations/lib/log-service'
import type { IntegrationStateService } from '../integrations/lib/state-service'
import type { PaymentOrderTotalResolver } from '@open-mercato/shared/modules/payment_gateways/types'
import { GatewayTransaction, WebhookProcessedEvent } from './data/entities'
import { createPaymentGatewayDescriptorService } from './lib/descriptor-service'
import { createPaymentGatewayService } from './lib/gateway-service'
import { isPaymentOrderTotalResolver } from './lib/order-amount-reconciliation'
import './privacy'

type Cradle = {
  em: EntityManager
  integrationCredentialsService: CredentialsService
  integrationLogService: IntegrationLogService
  integrationStateService: IntegrationStateService
}

const ORDER_TOTAL_RESOLVER_NAME = 'paymentOrderTotalResolver'

/**
 * The order-total resolver is owned by whichever module owns orders (`sales`
 * registers the default one). Its absence is the only supported reason to skip
 * amount reconciliation, so this only tolerates a missing registration: a
 * registered resolver that fails to build or does not satisfy the contract
 * throws instead of silently disabling the check.
 */
function resolveOrderTotalResolver(container: AppContainer, cradle: Cradle): PaymentOrderTotalResolver | null {
  if (!container.hasRegistration(ORDER_TOTAL_RESOLVER_NAME)) return null
  const candidate = (cradle as Cradle & { paymentOrderTotalResolver?: unknown })[ORDER_TOTAL_RESOLVER_NAME]
  if (!isPaymentOrderTotalResolver(candidate)) {
    throw new Error(`[internal] ${ORDER_TOTAL_RESOLVER_NAME} does not implement resolveOrderTotal`)
  }
  return candidate
}

export function register(container: AppContainer) {
  container.register({
    paymentGatewayService: asFunction((cradle: Cradle) =>
      createPaymentGatewayService({
        em: cradle.em,
        integrationCredentialsService: cradle.integrationCredentialsService,
        integrationLogService: cradle.integrationLogService,
        integrationStateService: cradle.integrationStateService,
        paymentOrderTotalResolver: resolveOrderTotalResolver(container, cradle),
      }),
    ).scoped().proxy(),
    paymentGatewayDescriptorService: asFunction(({ integrationCredentialsService, integrationStateService }: Cradle) =>
      createPaymentGatewayDescriptorService({ integrationCredentialsService, integrationStateService }),
    ).scoped().proxy(),

    GatewayTransaction: asValue(GatewayTransaction),
    WebhookProcessedEvent: asValue(WebhookProcessedEvent),
  })
}
