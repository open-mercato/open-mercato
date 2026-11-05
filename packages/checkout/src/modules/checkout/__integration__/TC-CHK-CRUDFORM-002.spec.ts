import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  assertScalarFieldsPersisted,
  skipIfCrudFormExtensionTestsDisabled,
} from '@open-mercato/core/helpers/integration/crudFormPersistence'
import {
  createFixedTemplateInput,
  createLinkFixture,
  createTemplateFixture,
  deleteCheckoutEntityIfExists,
  readLink,
  updateLink,
  type CheckoutLinkInput,
} from './helpers/fixtures'

/**
 * TC-CHK-CRUDFORM-002: pay-link CrudForm persists scalars, the templateId FK, slug
 * + custom fields (#2466 / #2566).
 *
 * The checkout pay-link surface is hand-written (command bus + bespoke serializer) and so does
 * NOT fit `runCrudFormRoundTrip` — see the note in TC-CHK-CRUDFORM-001. This spec drives the
 * canonical create → read-back → assert → update → read-back → assert → delete cycle inline,
 * reusing the sweep harness gate + scalar assertion helper.
 *
 * It covers the link-specific fields on top of the shared content fields: the `templateId`
 * foreign key and the generated `slug`, plus fixed-price money scalars, enums, booleans, an
 * integer, and default-seeded custom fields. Every explicitly-submitted field overrides the
 * source template (`pickExplicitParsedOverrides`), so the round-trip asserts the link's own
 * values, not inherited ones.
 *
 * Verified contract:
 * - Read-back uses the detail GET (the list route does not filter by `?ids=`/`?id=`).
 * - Custom fields submit as a `customFields` object and return under `record.customFields`.
 * - PUT is a partial update — omitted custom fields are retained; the slug is preserved when the
 *   name/title change (it recomputes from the existing slug).
 * - Self-contained: creates a throwaway template (no custom fields, so the link's own custom
 *   fields are not affected by template copy) and deletes both fixtures in `finally`.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
test.describe('TC-CHK-CRUDFORM-002: pay-link CrudForm persists scalars, templateId + slug + custom fields', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled()
  })

  test('round-trips scalars, templateId, slug, and custom fields on create and update', async ({ request }) => {
    const token = await getAuthToken(request)
    const stamp = Date.now()
    let templateId: string | null = null
    let linkId: string | null = null

    try {
      templateId = await createTemplateFixture(
        request,
        token,
        createFixedTemplateInput({ name: `QA CRUDFORM Link Template ${stamp}` }),
      )

      const createInput: CheckoutLinkInput = createFixedTemplateInput({
        name: `QA CRUDFORM Link ${stamp}`,
        title: `QA CRUDFORM Link Title ${stamp}`,
        subtitle: 'Original link subtitle',
        description: 'Original link description',
        fixedPriceAmount: 49.99,
        fixedPriceCurrencyCode: 'USD',
        fixedPriceIncludesTax: true,
        fixedPriceOriginalAmount: 69.99,
        collectCustomerDetails: true,
        displayCustomFieldsOnPage: true,
        customFieldsetCode: 'service_package',
        maxCompletions: 10,
        status: 'draft',
        templateId,
        slug: `qa-crudform-link-${stamp}`,
        customFields: {
          service_deliverables: 'One-on-one consultation call',
          delivery_timeline: 'Same week',
          support_contact: 'help@example.test',
        },
      })
      const created = await createLinkFixture(request, token, createInput)
      linkId = created.id

      const afterCreate = await readLink(request, token, linkId)
      assertScalarFieldsPersisted(
        afterCreate,
        {
          name: `QA CRUDFORM Link ${stamp}`,
          title: `QA CRUDFORM Link Title ${stamp}`,
          subtitle: 'Original link subtitle',
          description: 'Original link description',
          pricingMode: 'fixed',
          fixedPriceAmount: 49.99,
          fixedPriceCurrencyCode: 'USD',
          fixedPriceIncludesTax: true,
          fixedPriceOriginalAmount: 69.99,
          collectCustomerDetails: true,
          displayCustomFieldsOnPage: true,
          customFieldsetCode: 'service_package',
          maxCompletions: 10,
          status: 'draft',
          templateId,
          slug: created.slug,
        },
        'after-create',
      )
      expect(afterCreate.customFields, 'after-create custom fields should persist').toMatchObject({
        service_deliverables: 'One-on-one consultation call',
        delivery_timeline: 'Same week',
        support_contact: 'help@example.test',
      })

      const updatePayload: Partial<CheckoutLinkInput> = {
        name: `QA CRUDFORM Link ${stamp} EDITED`,
        title: `QA CRUDFORM Link Title ${stamp} EDITED`,
        subtitle: 'Updated link subtitle',
        description: 'Updated link description',
        pricingMode: 'fixed',
        fixedPriceAmount: 89.5,
        fixedPriceCurrencyCode: 'USD',
        fixedPriceIncludesTax: false,
        fixedPriceOriginalAmount: 129.99,
        gatewayProviderKey: 'mock',
        collectCustomerDetails: false,
        displayCustomFieldsOnPage: false,
        customFieldsetCode: 'service_package',
        maxCompletions: 20,
        status: 'active',
        customFields: {
          delivery_timeline: 'Next business day',
          session_format: 'In person',
        },
      }
      const updateResponse = await updateLink(request, token, linkId, updatePayload)
      expect(updateResponse.ok(), `update link failed: ${updateResponse.status()}`).toBeTruthy()

      const afterUpdate = await readLink(request, token, linkId)
      assertScalarFieldsPersisted(
        afterUpdate,
        {
          name: `QA CRUDFORM Link ${stamp} EDITED`,
          title: `QA CRUDFORM Link Title ${stamp} EDITED`,
          subtitle: 'Updated link subtitle',
          description: 'Updated link description',
          pricingMode: 'fixed',
          fixedPriceAmount: 89.5,
          fixedPriceCurrencyCode: 'USD',
          fixedPriceIncludesTax: false,
          fixedPriceOriginalAmount: 129.99,
          collectCustomerDetails: false,
          displayCustomFieldsOnPage: false,
          maxCompletions: 20,
          status: 'active',
          templateId,
          slug: created.slug,
        },
        'after-update',
      )
      expect(afterUpdate.customFields, 'after-update custom fields should persist + retain omitted keys').toMatchObject({
        delivery_timeline: 'Next business day',
        session_format: 'In person',
        service_deliverables: 'One-on-one consultation call',
        support_contact: 'help@example.test',
      })
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
    }
  })
})
