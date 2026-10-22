import { expect, test } from '@playwright/test'
import * as dg from './helpers/document-generators-api'
import { createRestrictedDocumentUser, type RestrictedDocumentUser } from './helpers/restricted-document-user'

test.describe('TC-DOCUMENT-020: template filter options scoped to access', () => {
  let restricted: RestrictedDocumentUser | null = null

  test.afterAll(async () => {
    await restricted?.cleanup()
  })

  test('facets omit values contributed solely by templates the caller cannot access', async ({ request }) => {
    test.setTimeout(90_000)
    restricted = await createRestrictedDocumentUser(request, { label: '020', sourceFeatures: ['sales.quotes.view'] })
    const response = await dg.listTemplateOptions(request, restricted.token)
    expect(response.status()).toBe(200)
    const body = (await response.json()) as { resourceKinds: string[]; formats: string[] }
    expect(body.resourceKinds).toContain(dg.QUOTE_KIND)
    expect(body.resourceKinds).not.toContain(dg.ORDER_KIND)
    expect(body.formats).toContain('pdf')
    expect(body.formats).not.toContain('md')
  })
})
