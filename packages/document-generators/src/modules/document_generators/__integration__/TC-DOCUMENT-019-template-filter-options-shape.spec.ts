import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { listTemplateFilterOptions } from './helpers/document-generators-api'

/**
 * TC-DOCUMENT-019: the filter-options endpoint returns facets, not a template dump.
 *
 * `/templates/options` exists so the templates list can render its filter
 * dropdowns without downloading the whole catalogue. It must therefore return
 * deduplicated, sorted value lists and must not leak template metadata under an
 * `items`/`templates` key — the facets are derived from the templates the caller
 * is allowed to see, so shipping the raw entries would bypass that narrowing.
 *
 * The assertions are deliberately module-agnostic: which resource kinds and
 * formats appear depends on the modules installed, and the Sales-specific values
 * are covered by TC-DOCUMENT-002 in the sales suite.
 */
test.describe('TC-DOCUMENT-019: template filter options shape', () => {
  test('returns deduplicated, sorted facets without template metadata', async ({ request }) => {
    const token = await getAuthToken(request)
    const options = await listTemplateFilterOptions(request, token)

    expect(Array.isArray(options.resourceKinds), 'resourceKinds should be an array').toBe(true)
    expect(Array.isArray(options.formats), 'formats should be an array').toBe(true)

    expect(options.resourceKinds, 'resourceKinds should be deduplicated and sorted')
      .toEqual([...new Set(options.resourceKinds)].sort())
    expect(options.formats, 'formats should be deduplicated and sorted')
      .toEqual([...new Set(options.formats)].sort())

    expect(options, 'facets must not carry the template list').not.toHaveProperty('items')
    expect(options, 'facets must not carry the template list').not.toHaveProperty('templates')
  })
})
