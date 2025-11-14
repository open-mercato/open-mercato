import type { EventBus } from '@open-mercato/events'
import {
  salesCalculations,
  type SalesLineCalculationResult,
  type SalesDocumentCalculationResult,
} from '../lib/calculations'
import type {
  CalculateLineOptions,
  CalculateDocumentOptions,
} from '../lib/types'

export type { CalculateLineOptions, CalculateDocumentOptions }

export interface SalesCalculationService {
  calculateLine(opts: Omit<CalculateLineOptions, 'eventBus'>): Promise<SalesLineCalculationResult>
  calculateDocumentTotals(
    opts: Omit<CalculateDocumentOptions, 'eventBus'>
  ): Promise<SalesDocumentCalculationResult>
}

export class DefaultSalesCalculationService implements SalesCalculationService {
  constructor(private readonly eventBus?: EventBus | null) {}

  calculateLine(opts: Omit<CalculateLineOptions, 'eventBus'>): Promise<SalesLineCalculationResult> {
    return salesCalculations.calculateLine({ ...opts, eventBus: this.eventBus })
  }

  calculateDocumentTotals(
    opts: Omit<CalculateDocumentOptions, 'eventBus'>
  ): Promise<SalesDocumentCalculationResult> {
    return salesCalculations.calculateDocument({ ...opts, eventBus: this.eventBus })
  }
}
