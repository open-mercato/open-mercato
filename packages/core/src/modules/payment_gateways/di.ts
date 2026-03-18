import { asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CredentialsService } from '../integrations/lib/credentials-service'
import type { IntegrationLogService } from '../integrations/lib/log-service'
import type { IntegrationStateService } from '../integrations/lib/state-service'
import { GatewayTransaction, WebhookProcessedEvent } from './data/entities'
import { createPaymentGatewayService } from './lib/gateway-service'

type Cradle = {
  em: EntityManager
  integrationCredentialsService: CredentialsService
  integrationLogService: IntegrationLogService
  integrationStateService: IntegrationStateService
}

export function register(container: AppContainer) {
  container.register({
    paymentGatewayService: asFunction(({ em, integrationCredentialsService, integrationLogService, integrationStateService }: Cradle) =>
      createPaymentGatewayService({ em, integrationCredentialsService, integrationLogService, integrationStateService }),
    ).scoped().proxy(),

    GatewayTransaction: asValue(GatewayTransaction),
    WebhookProcessedEvent: asValue(WebhookProcessedEvent),
  })
}
