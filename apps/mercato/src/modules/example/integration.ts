import type {
  IntegrationBundle,
  IntegrationDefinition,
} from '@open-mercato/shared/modules/integrations/types'

export const bundle: IntegrationBundle = {
  id: 'example_reference_bundle',
  title: 'Example reference providers',
  description: 'Credential-free providers used to demonstrate local integration discovery.',
  package: 'src/modules/example',
  version: '1.0.0',
  credentials: { fields: [] },
}

export const integrations: IntegrationDefinition[] = [
  {
    id: 'example_mock_payment',
    title: 'Example mock payment',
    description: 'Local payment identity backed by the example mock gateway adapter.',
    category: 'payment',
    hub: 'payment_gateways',
    providerKey: 'mock',
    bundleId: 'example_reference_bundle',
    package: 'src/modules/example',
    version: '1.0.0',
    credentials: { fields: [] },
  },
  {
    id: 'example_mock_shipping',
    title: 'Example mock shipping',
    description: 'Local shipping identity backed by the example mock carrier adapter.',
    category: 'shipping',
    hub: 'shipping_carriers',
    providerKey: 'mock_carrier',
    bundleId: 'example_reference_bundle',
    package: 'src/modules/example',
    version: '1.0.0',
    credentials: { fields: [] },
  },
  {
    id: 'example_fixed_currency',
    title: 'Example fixed currency rates',
    description: 'Deterministic in-memory exchange rates for reference and test flows.',
    category: 'currency',
    hub: 'currencies',
    providerKey: 'example_fixed_rates',
    bundleId: 'example_reference_bundle',
    package: 'src/modules/example',
    version: '1.0.0',
    credentials: { fields: [] },
  },
]

export const bundles: IntegrationBundle[] = [bundle]
