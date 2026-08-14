import { expect, test } from '@playwright/test'
import {
  listTemplateFilterOptions,
  listTemplates,
} from '@open-mercato/document-generators/modules/document_generators/__integration__/helpers/document-generators-api'
import { withRestrictedDocumentUser } from './helpers/restricted-document-user'

/**
 * TC-DOCUMENT-010: the catalogue hides templates the caller may not use.
 *
 * Sales templates declare the source-module features they require —
 * `sales.orders.view` for the invoices, `sales.quotes.view` for the offer. A
 * subject that may use the document generator but has no access to the
 * underlying Sales records must not see those templates at all: the catalogue is
 * the entry point of the UI, and a listed template is an offer to render it.
 *
 * The facets are asserted alongside the listing because they are computed from
 * the authorized set — leaking `sales.order` there would tell an unauthorized
 * caller which document families exist even with an empty list.
 */
test.describe('TC-DOCUMENT-010: template access hides unauthorized templates', () => {
  test('omits Sales templates and their facets for a caller without Sales features', async ({ request }) => {
    test.slow()

    await withRestrictedDocumentUser(request, { label: 'docs-no-sales' }, async (token) => {
      const templates = await listTemplates(request, token)
      const salesTemplates = templates.filter((template) => template.module === 'sales')

      expect(
        salesTemplates.map((template) => template.id),
        'templates requiring Sales features must not be offered',
      ).toEqual([])

      const options = await listTemplateFilterOptions(request, token)
      expect(options.resourceKinds, 'the order facet is derived from a hidden template')
        .not.toContain('sales.order')
      expect(options.resourceKinds, 'the quote facet is derived from a hidden template')
        .not.toContain('sales.quote')
    })
  })
})
