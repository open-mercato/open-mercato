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

type Cradle = {
  em: EntityManager
  integrationCredentialsService: CredentialsService
  integrationLogService: IntegrationLogService
  integrationStateService: IntegrationStateService
}

/**
 * The order-total resolver is owned by whichever module owns orders (`sales`
 * registers the default one). It is optional on purpose: an installation
 * without that module resolves nothing and session amounts stay unreconciled
 * rather than failing.
 */
function tryResolveOrderTotalResolver(cradle: Cradle): PaymentOrderTotalResolver | null {
  try {
    const candidate = (cradle as Cradle & { paymentOrderTotalResolver?: unknown }).paymentOrderTotalResolver
    return isPaymentOrderTotalResolver(candidate) ? candidate : null
  } catch {
    return null
  }
}

export function register(container: AppContainer) {
  container.register({
    paymentGatewayService: asFunction((cradle: Cradle) =>
      createPaymentGatewayService({
        em: cradle.em,
        integrationCredentialsService: cradle.integrationCredentialsService,
        integrationLogService: cradle.integrationLogService,
        integrationStateService: cradle.integrationStateService,
        paymentOrderTotalResolver: tryResolveOrderTotalResolver(cradle),
      }),
    ).scoped().proxy(),
    paymentGatewayDescriptorService: asFunction(({ integrationCredentialsService, integrationStateService }: Cradle) =>
      createPaymentGatewayDescriptorService({ integrationCredentialsService, integrationStateService }),
    ).scoped().proxy(),

    GatewayTransaction: asValue(GatewayTransaction),
    WebhookProcessedEvent: asValue(WebhookProcessedEvent),
  })
}
