import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'
import { inpostWebhookSetupGuide } from './webhook-guide'

export const carrierInpostDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('carrier_inpost')

export const integration: IntegrationDefinition = {
  id: 'carrier_inpost',
  title: 'InPost',
  description: 'Ship parcels via InPost lockers (Paczkomat) and courier delivery with real-time tracking.',
  category: 'shipping',
  hub: 'shipping_carriers',
  providerKey: 'inpost',
  icon: 'inpost',
  docsUrl: 'https://developers.inpost.pl',
  package: '@open-mercato/carrier-inpost',
  version: '1.0.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['paczkomat', 'locker', 'courier', 'poland', 'pl', 'cee'],
  detailPage: {
    widgetSpotId: carrierInpostDetailWidgetSpotId,
  },
  credentials: {
    fields: [
      {
        key: 'apiToken',
        label: 'API Token (Bearer)',
        type: 'secret',
        required: true,
        helpText: 'Organization API token from InPost Manager (Manager -> API -> Tokens).',
      },
      {
        key: 'organizationId',
        label: 'Organization ID',
        type: 'text',
        required: true,
        helpText: 'Your InPost organization numeric ID (integer, e.g. 6183). Use GET /v1/organizations to discover it — do NOT use the JWT account UUID.',
      },
      {
        key: 'apiBaseUrl',
        label: 'API Base URL',
        type: 'url',
        required: false,
        placeholder: 'https://api-shipx-pl.easypack24.net',
        helpText: 'Leave empty for production. Use the sandbox URL for testing.',
      },
      {
        key: 'apiPointsBaseUrl',
        label: 'Points API Base URL',
        type: 'url',
        required: false,
        placeholder: 'https://api.inpost.pl',
        helpText: 'Leave empty for production. Use the sandbox Points API URL for testing.',
      },
      {
        key: 'webhookSecret',
        label: 'Webhook Secret',
        type: 'secret',
        required: false,
        helpText: 'HMAC-SHA256 signing secret for webhook signature verification.',
        helpDetails: inpostWebhookSetupGuide,
      },
      {
        key: 'senderCompanyName',
        label: 'Sender Company Name',
        type: 'text',
        required: false,
        helpText: 'Company name shown on the sender label. Leave empty to omit.',
      },
      {
        key: 'senderFirstName',
        label: 'Sender First Name',
        type: 'text',
        required: false,
        helpText: 'First name of the sender contact.',
      },
      {
        key: 'senderLastName',
        label: 'Sender Last Name',
        type: 'text',
        required: false,
        helpText: 'Last name of the sender contact.',
      },
      {
        key: 'senderEmail',
        label: 'Sender Email',
        type: 'text',
        required: false,
        helpText: 'Email address of the sender contact.',
      },
      {
        key: 'senderPhone',
        label: 'Sender Phone',
        type: 'text',
        required: false,
        helpText: 'Phone number of the sender contact (e.g. +48123456789).',
      },
      {
        key: 'receiverCompanyName',
        label: 'Default Receiver Company Name',
        type: 'text',
        required: false,
        helpText: 'Fallback company name for the receiver when not provided by the shipment.',
      },
      {
        key: 'receiverFirstName',
        label: 'Default Receiver First Name',
        type: 'text',
        required: false,
        helpText: 'Fallback first name for the receiver when not provided by the shipment.',
      },
      {
        key: 'receiverLastName',
        label: 'Default Receiver Last Name',
        type: 'text',
        required: false,
        helpText: 'Fallback last name for the receiver when not provided by the shipment.',
      },
      {
        key: 'receiverEmail',
        label: 'Default Receiver Email',
        type: 'text',
        required: false,
        helpText: 'Fallback email for the receiver. Also used as the contact email for rate calculations.',
      },
      {
        key: 'receiverPhone',
        label: 'Default Receiver Phone',
        type: 'text',
        required: false,
        helpText: 'Fallback phone for the receiver. Also used as the contact phone for rate calculations.',
      },
      {
        key: 'targetPoint',
        label: 'Default Target Locker Point',
        type: 'text',
        required: false,
        helpText: 'Default Paczkomat locker point code used as the delivery destination (e.g. KRA010). Required for locker services when not selected at checkout.',
      },
      {
        key: 'c2cSendingMethod',
        label: 'C2C Sending Method',
        type: 'select',
        required: false,
        options: [
          { value: 'dispatch_order', label: 'Courier pickup from sender address (default)' },
          { value: 'parcel_locker', label: 'Drop at a Paczkomat locker' },
          { value: 'pop', label: 'Drop at a POP (Post Office Point)' },
          { value: 'any_point', label: 'Any available drop-off point' },
        ],
        helpText: 'Sending method for Courier C2C shipments. Defaults to courier pickup.',
      },
    ],
  },
  healthCheck: { service: 'inpostHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
