import type { EventBus } from '@open-mercato/events'
import type { CurrencyPrecisionLookup } from '@open-mercato/shared/lib/currencyPrecision'
import { salesCalculations } from '../lib/calculations'
import type {
  CalculateLineOptions,
  CalculateDocumentOptions,
  SalesCalculationContext,
  SalesLineCalculationResult,
  SalesDocumentCalculationResult,
} from '../lib/types'

export type AmountDecimalPlacesResolver = (lookup: CurrencyPrecisionLookup) => Promise<number>

export type { CalculateLineOptions, CalculateDocumentOptions }

export interface SalesCalculationService {
  calculateLine(opts: Omit<CalculateLineOptions, 'eventBus'>): Promise<SalesLineCalculationResult>
  calculateDocumentTotals(
    opts: Omit<CalculateDocumentOptions, 'eventBus'>
  ): Promise<SalesDocumentCalculationResult>
}

export class DefaultSalesCalculationService implements SalesCalculationService {
  constructor(
    private readonly eventBus?: EventBus | null,
    private readonly resolveAmountDecimalPlaces?: AmountDecimalPlacesResolver | null,
  ) {}

  async calculateLine(opts: Omit<CalculateLineOptions, 'eventBus'>): Promise<SalesLineCalculationResult> {
    const context = await this.withAmountDecimalPlaces(opts.context)
    return salesCalculations.calculateLine({ ...opts, context, eventBus: this.eventBus })
  }

  async calculateDocumentTotals(
    opts: Omit<CalculateDocumentOptions, 'eventBus'>
  ): Promise<SalesDocumentCalculationResult> {
    const context = await this.withAmountDecimalPlaces(opts.context)
    return salesCalculations.calculateDocument({ ...opts, context, eventBus: this.eventBus })
  }

  private async withAmountDecimalPlaces(context: SalesCalculationContext): Promise<SalesCalculationContext> {
    if (context.amountDecimalPlaces !== undefined || !this.resolveAmountDecimalPlaces) return context
    const amountDecimalPlaces = await this.resolveAmountDecimalPlaces({
      code: context.currencyCode,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })
    return { ...context, amountDecimalPlaces }
  }
}
