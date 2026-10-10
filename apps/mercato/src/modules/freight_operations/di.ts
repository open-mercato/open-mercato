import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { FreightDocumentSequence, FreightOrder, FreightPayment } from './data/entities'
import { createFreightService } from './lib/freightService'

export function register(container: AppContainer) {
  container.register({
    FreightOrder: asValue(FreightOrder),
    FreightDocumentSequence: asValue(FreightDocumentSequence),
    FreightPayment: asValue(FreightPayment),
    freightService: asFunction(createFreightService).scoped(),
  })
}
