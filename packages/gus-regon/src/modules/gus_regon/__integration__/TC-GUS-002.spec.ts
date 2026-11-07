import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getIntegrationDetail } from './helpers/fixtures'

/**
 * TC-GUS-002: integration registration
 *
 * The provider is registered in the integrations hub with the credential
 * fields rendered in Settings → Integrations (environment, secret API key,
 * "Show on CRM company forms" switch).
 */
test.describe('TC-GUS-002: GUS REGON integration registration', () => {
  test('exposes environment, a secret API key and the company-forms switch as credential fields', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const detail = await getIntegrationDetail(request, token)

    expect(detail.integration.id).toBe('gus_regon')
    const fields = detail.integration.credentials?.fields ?? []
    expect(fields.find((field) => field.key === 'environment')?.type).toBe('select')
    expect(fields.find((field) => field.key === 'apiKey')?.type).toBe('secret')
    expect(fields.find((field) => field.key === 'showOnCompanyForms')?.type).toBe('boolean')
  })
})
