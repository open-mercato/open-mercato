import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import * as dg from './helpers/document-generators-api'
import { createRestrictedDocumentUser, type RestrictedDocumentUser } from './helpers/restricted-document-user'

test.describe('TC-DOCUMENT-010: template access hides unauthorized', () => {
  let restricted: RestrictedDocumentUser | null = null

  test.afterAll(async () => {
    await restricted?.cleanup()
  })

  test('GET /templates omits templates whose required features the caller lacks', async ({ request }) => {
    test.setTimeout(90_000)
    restricted = await createRestrictedDocumentUser(request, { label: '010', sourceFeatures: ['sales.quotes.view'] })
    const ids = (await dg.readTemplates(await dg.listTemplates(request, restricted.token))).map((template) => template.id)
    expect(ids).toContain(dg.QUOTE_PDF_TEMPLATE)
    expect(ids).not.toContain(dg.ORDER_PDF_TEMPLATE)
    expect(ids).not.toContain(dg.ORDER_MARKDOWN_TEMPLATE)

    const adminToken = await getAuthToken(request, 'admin')
    const adminIds = (await dg.readTemplates(await dg.listTemplates(request, adminToken))).map((template) => template.id)
    expect(adminIds).toEqual(expect.arrayContaining([dg.QUOTE_PDF_TEMPLATE, dg.ORDER_PDF_TEMPLATE, dg.ORDER_MARKDOWN_TEMPLATE]))
  })
})
