import { asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { WarrantyClaimNumberGenerator } from './services/claimNumberGenerator'
import {
  WarrantyClaim,
  WarrantyClaimEvent,
  WarrantyClaimLine,
  WarrantyClaimSequence,
} from './data/entities'

type AppCradle = AppContainer['cradle'] & {
  em: EntityManager
}

export function register(container: AppContainer) {
  container.register({
    warrantyClaimNumberGenerator: asFunction(({ em }: AppCradle) => {
      return new WarrantyClaimNumberGenerator(em)
    })
      .singleton()
      .proxy(),
    WarrantyClaim: asValue(WarrantyClaim),
    WarrantyClaimLine: asValue(WarrantyClaimLine),
    WarrantyClaimEvent: asValue(WarrantyClaimEvent),
    WarrantyClaimSequence: asValue(WarrantyClaimSequence),
  })
}
