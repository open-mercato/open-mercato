import { asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { WarrantyClaimNumberGenerator } from './services/claimNumberGenerator'
import { createWarrantyAdjudicationEvaluator } from './services/adjudicationEvaluator'
import { createWarrantyEntitlementResolver } from './services/entitlementResolver'
import { createWarrantyReturnLabelProvider } from './services/returnLabelProvider'
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
    warrantyEntitlementResolver: asFunction(() => createWarrantyEntitlementResolver()).singleton(),
    warrantyReturnLabelProvider: asFunction(() => createWarrantyReturnLabelProvider()).singleton(),
    warrantyAdjudicationEvaluator: asFunction(() => createWarrantyAdjudicationEvaluator()).singleton(),
    WarrantyClaim: asValue(WarrantyClaim),
    WarrantyClaimLine: asValue(WarrantyClaimLine),
    WarrantyClaimEvent: asValue(WarrantyClaimEvent),
    WarrantyClaimSequence: asValue(WarrantyClaimSequence),
  })
}
