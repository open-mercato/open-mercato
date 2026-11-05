import { asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CredentialsService } from '../integrations/lib/credentials-service'
import { CarrierShipment } from './data/entities'
import { createShippingCarrierService } from './lib/shipping-service'

type Cradle = {
  em: EntityManager
  integrationCredentialsService: CredentialsService
}

export function register(container: AppContainer) {
  container.register({
    shippingCarrierService: asFunction(({ em, integrationCredentialsService }: Cradle) =>
      createShippingCarrierService({ em, integrationCredentialsService }),
    ).scoped().proxy(),
    CarrierShipment: asValue(CarrierShipment),
  })
}
