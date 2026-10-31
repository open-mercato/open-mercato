import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'
import { XERO_CONNECT_TAB_ID, XERO_INTEGRATION_ID, XERO_PROVIDER_KEY } from './lib/constants'
import { buildXeroContactUrl } from './lib/external-ids'

export const syncXeroDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId(XERO_INTEGRATION_ID)

export const integration: IntegrationDefinition = {
  id: XERO_INTEGRATION_ID,
  title: 'Xero',
  description: 'Connect a Xero Organisation and import its Contacts into Open Mercato Companies on a schedule, without duplicates.',
  category: 'data_sync',
  hub: 'data_sync',
  providerKey: XERO_PROVIDER_KEY,
  icon: 'receipt',
  docsUrl: 'https://developer.xero.com/documentation/guides/oauth2/auth-flow/',
  package: '@open-mercato/sync-xero',
  version: '1.0.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['xero', 'accounting', 'contacts', 'companies', 'oauth'],
  buildExternalUrl: buildXeroContactUrl,
  detailPage: {
    widgetSpotId: syncXeroDetailWidgetSpotId,
    connectTabId: XERO_CONNECT_TAB_ID,
  },
  credentials: {
    fields: [
      {
        key: 'clientId',
        label: 'Client ID',
        type: 'text',
        required: true,
        helpText: 'Create a Web app at developer.xero.com, register the redirect URI shown on the Xero tab, and copy the app\'s Client ID.',
      },
      {
        key: 'clientSecret',
        label: 'Client Secret',
        type: 'secret',
        required: true,
        helpText: 'Generate a Client Secret for the same Xero app.',
      },
    ],
  },
  healthCheck: { service: 'xeroHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
