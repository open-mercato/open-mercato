import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const TEST_OAUTH_GRANT_INTEGRATION_ID = 'test_oauth_grant'

export function isTestOAuthGrantsEnabled(): boolean {
  return parseBooleanWithDefault(process.env.OM_ENABLE_TEST_OAUTH_GRANTS, false)
}

const testOAuthGrantIntegration: IntegrationDefinition = {
  id: TEST_OAUTH_GRANT_INTEGRATION_ID,
  title: 'Zz Test OAuth Grant',
  credentials: {
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text' },
      { key: 'clientSecret', label: 'Client secret', type: 'secret' },
    ],
  },
  detailPage: { connectTabId: 'health' },
}

export const integrations: IntegrationDefinition[] = isTestOAuthGrantsEnabled() ? [testOAuthGrantIntegration] : []
