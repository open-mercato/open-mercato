import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  assertScalarFieldsPersisted,
  skipIfCrudFormExtensionTestsDisabled,
} from '@open-mercato/core/helpers/integration/crudFormPersistence'
import {
  createPriceListTemplateInput,
  createTemplateFixture,
  deleteCheckoutEntityIfExists,
  readTemplate,
  updateTemplate,
  type CheckoutLinkInput,
} from './helpers/fixtures'

/**
 * TC-CHK-CRUDFORM-001: pay-link template CrudForm persists scalars, a price-list array
 * + custom fields (#2466 / #2566).
 *
 * The checkout template surface is hand-written (command bus + bespoke serializer), so it
 * does NOT fit `runCrudFormRoundTrip` from the sweep harness:
 * - writes go through the collection POST (`/api/checkout/templates`) but updates/deletes go
 *   through the RESTful detail route (`/api/checkout/templates/[id]`), not a `?id=` collection
 *   route;
 * - the serializer returns camelCase fields (not the makeCrud snake_case shape);
 * - custom fields come back as a top-level `customFields` object (not an array / `customValues`).
 *
 * This spec therefore drives the canonical create → read-back → assert → update → read-back →
 * assert → delete cycle inline using the checkout integration fixtures, while reusing the sweep
 * harness gate (`skipIfCrudFormExtensionTestsDisabled`) and scalar assertion helper. It proves
 * every field type the template CrudForm edits round-trips: string scalars, enums (pricingMode,
 * status), booleans, an integer, the `priceListItems` array, and default-seeded custom fields.
 *
 * Verified contract:
 * - Read-back uses the detail GET (the list route does not filter by `?ids=`/`?id=`).
 * - Custom fields submit as a `customFields` object and return under `record.customFields`.
 * - PUT is a partial update — omitted custom fields are retained.
 * - Self-contained: custom-field definitions are seeded by `seedDefaults`; the template is the
 *   only fixture and is deleted in `finally`.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
test.describe('TC-CHK-CRUDFORM-001: pay-link template CrudForm persists scalars, array + custom fields', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled()
  })

  test('round-trips scalars, priceListItems array, and custom fields on create and update', async ({ request }) => {
    const token = await getAuthToken(request)
    const stamp = Date.now()
    let templateId: string | null = null

    try {
      const createInput: CheckoutLinkInput = createPriceListTemplateInput({
        name: `QA CRUDFORM Template ${stamp}`,
        title: `QA CRUDFORM Template Title ${stamp}`,
        subtitle: 'Original template subtitle',
        description: 'Original template description',
        priceListItems: [
          { id: 'tier-basic', description: 'Basic tier', amount: 19.99, currencyCode: 'USD' },
          { id: 'tier-pro', description: 'Pro tier', amount: 49.99, currencyCode: 'USD' },
        ],
        collectCustomerDetails: true,
        displayCustomFieldsOnPage: true,
        customFieldsetCode: 'service_package',
        maxCompletions: 25,
        status: 'draft',
        customFields: {
          service_deliverables: 'Discovery workshop and implementation memo',
          delivery_timeline: 'Within 5 business days',
          support_contact: 'ops@example.test',
        },
      })
      templateId = await createTemplateFixture(request, token, createInput)

      const afterCreate = await readTemplate(request, token, templateId)
      assertScalarFieldsPersisted(
        afterCreate,
        {
          name: `QA CRUDFORM Template ${stamp}`,
          title: `QA CRUDFORM Template Title ${stamp}`,
          subtitle: 'Original template subtitle',
          description: 'Original template description',
          pricingMode: 'price_list',
          priceListItems: [
            { id: 'tier-basic', description: 'Basic tier', amount: 19.99, currencyCode: 'USD' },
            { id: 'tier-pro', description: 'Pro tier', amount: 49.99, currencyCode: 'USD' },
          ],
          collectCustomerDetails: true,
          displayCustomFieldsOnPage: true,
          customFieldsetCode: 'service_package',
          maxCompletions: 25,
          status: 'draft',
        },
        'after-create',
      )
      expect(afterCreate.customFields, 'after-create custom fields should persist').toMatchObject({
        service_deliverables: 'Discovery workshop and implementation memo',
        delivery_timeline: 'Within 5 business days',
        support_contact: 'ops@example.test',
      })

      const updatePayload: Partial<CheckoutLinkInput> = {
        name: `QA CRUDFORM Template ${stamp} EDITED`,
        title: `QA CRUDFORM Template Title ${stamp} EDITED`,
        subtitle: 'Updated template subtitle',
        description: 'Updated template description',
        pricingMode: 'price_list',
        priceListItems: [
          { id: 'tier-solo', description: 'Solo tier', amount: 99, currencyCode: 'USD' },
        ],
        gatewayProviderKey: 'mock',
        collectCustomerDetails: false,
        displayCustomFieldsOnPage: false,
        customFieldsetCode: 'service_package',
        maxCompletions: 50,
        status: 'active',
        customFields: {
          delivery_timeline: 'Within 2 business days',
          session_format: 'Remote video call',
        },
      }
      const updateResponse = await updateTemplate(request, token, templateId, updatePayload)
      expect(
        updateResponse.ok(),
        `update template failed: ${updateResponse.status()}`,
      ).toBeTruthy()

      const afterUpdate = await readTemplate(request, token, templateId)
      assertScalarFieldsPersisted(
        afterUpdate,
        {
          name: `QA CRUDFORM Template ${stamp} EDITED`,
          title: `QA CRUDFORM Template Title ${stamp} EDITED`,
          subtitle: 'Updated template subtitle',
          description: 'Updated template description',
          pricingMode: 'price_list',
          priceListItems: [
            { id: 'tier-solo', description: 'Solo tier', amount: 99, currencyCode: 'USD' },
          ],
          collectCustomerDetails: false,
          displayCustomFieldsOnPage: false,
          maxCompletions: 50,
          status: 'active',
        },
        'after-update',
      )
      expect(afterUpdate.customFields, 'after-update custom fields should persist + retain omitted keys').toMatchObject({
        delivery_timeline: 'Within 2 business days',
        session_format: 'Remote video call',
        service_deliverables: 'Discovery workshop and implementation memo',
        support_contact: 'ops@example.test',
      })
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
    }
  })
})
