import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { listTemplateFilterOptions } from '@open-mercato/document-generators/modules/document_generators/__integration__/helpers/document-generators-api'

/**
 * TC-DOCUMENT-002: Sales template facets reach the catalogue filters.
 *
 * The filter dropdowns on the templates list are built from
 * `/templates/options`, which derives its facets from the registered templates.
 * Sales contributes both of its resource kinds and both output formats, so the
 * absence of any of these values means a whole family of Sales documents cannot
 * be filtered to — a failure the catalogue listing itself would not reveal.
 *
 * The generic shape of the response (sorted, deduplicated, no template dump) is
 * covered by TC-DOCUMENT-019 in the document_generators suite.
 */
test.describe('TC-DOCUMENT-002: Sales facets in template filter options', () => {
  test('exposes the sales resource kinds and both output formats', async ({ request }) => {
    const token = await getAuthToken(request)
    const options = await listTemplateFilterOptions(request, token)

    expect(options.resourceKinds, 'orders should be filterable').toContain('sales.order')
    expect(options.resourceKinds, 'quotes should be filterable').toContain('sales.quote')
    expect(options.formats, 'the PDF templates should contribute the pdf facet').toContain('pdf')
    expect(options.formats, 'the markdown invoice should contribute the md facet').toContain('md')
  })
})
