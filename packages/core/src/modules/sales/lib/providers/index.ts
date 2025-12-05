import { ensureProviderTotalsCalculator } from './totals'
import { registerDefaultSalesProviders } from './defaultProviders'

registerDefaultSalesProviders()
ensureProviderTotalsCalculator()

export {
  getPaymentProvider,
  getShippingProvider,
  listPaymentProviders,
  listShippingProviders,
  normalizeProviderSettings,
  registerPaymentProvider,
  registerShippingProvider,
} from './registry'
export { registerStripeProvider } from './defaultProviders'

export type {
  PaymentProvider,
  PaymentProviderCalculateInput,
  PaymentMethodContext,
  ProviderAdjustment,
  ProviderAdjustmentResult,
  ProviderSettingField,
  ProviderSettingsDefinition,
  ShippingMetrics,
  ShippingMethodContext,
  ShippingProvider,
  ShippingProviderCalculateInput,
} from './types'
