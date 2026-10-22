import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import * as dg from './helpers/document-generators-api'

test.describe('TC-DOCUMENT-001: sales templates listed', () => {
  test('GET /templates returns the registered Sales templates and honors filters', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const templates = await dg.readTemplates(await dg.listTemplates(request, token))
    const byId = new Map(templates.map((template) => [template.id, template]))
    expect(byId.get(dg.ORDER_PDF_TEMPLATE)).toMatchObject({ resourceKind: dg.ORDER_KIND, format: 'pdf' })
    expect(byId.get(dg.ORDER_MARKDOWN_TEMPLATE)).toMatchObject({ resourceKind: dg.ORDER_KIND, format: 'md' })
    expect(byId.get(dg.QUOTE_PDF_TEMPLATE)).toMatchObject({ resourceKind: dg.QUOTE_KIND, format: 'pdf' })
    expect(byId.get(dg.ORDER_PDF_TEMPLATE)?.requiredFeatures).toContain('sales.orders.view')

    const quoteOnly = await dg.readTemplates(await dg.listTemplates(request, token, { resource_kind: dg.QUOTE_KIND }))
    expect(quoteOnly.map((template) => template.id)).toContain(dg.QUOTE_PDF_TEMPLATE)
    expect(quoteOnly.every((template) => template.resourceKind === dg.QUOTE_KIND)).toBe(true)

    const markdownOnly = await dg.readTemplates(await dg.listTemplates(request, token, { format: 'md' }))
    expect(markdownOnly.map((template) => template.id)).toContain(dg.ORDER_MARKDOWN_TEMPLATE)
    expect(markdownOnly.every((template) => template.format === 'md')).toBe(true)
  })
})
