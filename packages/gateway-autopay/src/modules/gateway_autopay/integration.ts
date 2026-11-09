import type { IntegrationBundle, IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const integration: IntegrationDefinition = {
  id: 'gateway_autopay',
  title: 'Autopay',
  description: 'Accept hosted PLN payments (bank transfers, BLIK, cards) via Autopay Online.',
  category: 'payment',
  hub: 'payment_gateways',
  providerKey: 'autopay',
  icon: 'autopay',
  docsUrl: 'https://developers.autopay.pl/online/dokumentacja-v1-1',
  package: '@open-mercato/gateway-autopay',
  version: '1.0.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['pln', 'blik', 'bank-transfer', 'poland', 'hosted-redirect'],
  credentials: {
    fields: [
      {
        key: 'serviceId',
        label: 'Service ID',
        type: 'text',
        required: true,
        placeholder: '2',
        helpText: 'Register your own Partner Service at https://portal.autopay.eu/ to get this. The sandbox worked-example value "2" only verifies the hash math, never a real session.',
      },
      {
        key: 'sharedKey',
        label: 'Shared Key',
        type: 'secret',
        required: true,
        helpText: 'Issued alongside the Service ID at https://portal.autopay.eu/. Used to sign and verify every message (plain concatenated hash, not HMAC). The sandbox worked-example value "2test2" only verifies the hash math, never a real session.',
      },
      {
        key: 'hashAlgorithm',
        label: 'Hash Algorithm',
        type: 'select',
        required: false,
        options: [
          { value: 'sha256', label: 'SHA-256 (default)' },
          { value: 'sha512', label: 'SHA-512' },
        ],
        helpText: 'Fixed per Service during Autopay onboarding; defaults to SHA-256 if not specified there.',
      },
      {
        key: 'gatewayUrl',
        label: 'Payment Initiation URL',
        type: 'url',
        required: true,
        placeholder: 'https://testpay.autopay.eu/<path-issued-at-onboarding>',
        helpText: 'The exact hosted-session URL Autopay issues per Partner Service when you register at https://portal.autopay.eu/. Never guess this value — it is specific to your own registration, not a fixed public path. The host must be https://testpay.autopay.eu (sandbox) or https://pay.autopay.eu (production); the status/cancel/refund API host is derived from this URL.',
      },
    ],
  },
  healthCheck: { service: 'autopayHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
