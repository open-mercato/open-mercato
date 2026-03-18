import type { IntegrationBundle, IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const integration: IntegrationDefinition = {
  id: 'webhook_custom',
  title: 'Custom Webhooks',
  description: 'Send and receive webhooks using the Standard Webhooks specification.',
  category: 'webhook',
  hub: 'webhook_endpoints',
  providerKey: 'webhook_custom',
  icon: 'webhook',
  package: '@open-mercato/webhooks',
  version: '1.0.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'Proprietary',
  tags: ['webhooks', 'automation', 'events', 'standard-webhooks'],
  credentials: {
    fields: [],
  },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
