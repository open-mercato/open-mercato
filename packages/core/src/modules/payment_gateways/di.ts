import { asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CredentialsService } from '../integrations/lib/credentials-service'
import type { IntegrationLogService } from '../integrations/lib/log-service'
import { GatewayTransaction, WebhookProcessedEvent } from './data/entities'
import { createPaymentGatewayService } from './lib/gateway-service'

type Cradle = {
  em: EntityManager
  integrationCredentialsService: CredentialsService
  integrationLogService: IntegrationLogService
}

export function register(container: AppContainer) {
  container.register({
    paymentGatewayService: asFunction(({ em, integrationCredentialsService, integrationLogService }: Cradle) =>
      createPaymentGatewayService({ em, integrationCredentialsService, integrationLogService }),
    ).scoped().proxy(),

    GatewayTransaction: asValue(GatewayTransaction),
    WebhookProcessedEvent: asValue(WebhookProcessedEvent),
  })
}
