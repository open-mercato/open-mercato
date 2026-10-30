import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'
import { GUS_REGON_INTEGRATION_ID } from './lib/config'

export const gusRegonDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId(GUS_REGON_INTEGRATION_ID)

/**
 * GUS REGON (BIR1.1) provider registration. Credentials are stored encrypted
 * per organization by the platform IntegrationCredentialsService and edited in
 * Settings → Integrations → GUS REGON.
 */
export const integration: IntegrationDefinition = {
  id: GUS_REGON_INTEGRATION_ID,
  title: 'GUS REGON (BIR1)',
  description: 'Autofill Polish company data (name, REGON, registered address) by NIP from the GUS REGON registry.',
  category: 'other',
  providerKey: 'gus_regon',
  icon: 'building',
  docsUrl: 'https://api.stat.gov.pl/Home/RegonApi',
  package: '@open-mercato/gus-regon',
  version: '1.0.0',
  author: 'Cognize',
  company: 'Cognize',
  license: 'MIT',
  tags: ['poland', 'pl', 'gus', 'regon', 'nip', 'company-lookup', 'registry'],
  detailPage: {
    widgetSpotId: gusRegonDetailWidgetSpotId,
  },
  credentials: {
    fields: [
      {
        key: 'environment',
        label: 'Environment',
        type: 'select',
        required: true,
        options: [
          { value: 'test', label: 'Test (synthetic GUS data)' },
          { value: 'production', label: 'Production' },
        ],
        helpText: 'Test uses the GUS test registry with synthetic data. Production requires your own BIR API key.',
      },
      {
        key: 'apiKey',
        label: 'BIR API key',
        type: 'secret',
        required: false,
        helpText: 'User key issued by GUS for the BIR1.1 API. Required for Production and for the CRM company card. Leave empty in Test to use the public GUS test key for lookups only.',
      },
      {
        key: 'showOnCompanyForms',
        label: 'Show on CRM company forms',
        type: 'boolean',
        required: false,
        helpText: 'Adds the "Fetch from GUS" card to the company create and edit forms. Off by default. Has no effect until an API key is provided.',
      },
    ],
  },
  healthCheck: { service: 'gusRegonHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
