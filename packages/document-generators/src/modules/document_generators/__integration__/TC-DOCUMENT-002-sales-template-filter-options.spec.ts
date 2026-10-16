import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import * as dg from './helpers/document-generators-api'

test.describe('TC-DOCUMENT-002: sales template filter options', () => {
  test('GET /templates/options returns the resource kind and format facets', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await dg.listTemplateOptions(request, token)
    expect(response.status()).toBe(200)
    const body = (await response.json()) as { resourceKinds: string[]; formats: string[] }
    expect(body.resourceKinds).toEqual(expect.arrayContaining([dg.ORDER_KIND, dg.QUOTE_KIND]))
    expect(body.formats).toEqual(expect.arrayContaining(['pdf', 'md']))
  })
})
