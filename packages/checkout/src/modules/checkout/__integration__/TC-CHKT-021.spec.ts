import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createFixedTemplateInput,
  createLinkFixture,
  createTemplateFixture,
  deleteCheckoutEntityIfExists,
  readLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-021: Custom fields copy from template to link', () => {
  test('copies template custom-field values when a link is created from the template', async ({ request }) => {
    let token: string | null = null
    let templateId: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      templateId = await createTemplateFixture(request, token, {
        ...createFixedTemplateInput({
          customFieldsetCode: 'service_package',
          displayCustomFieldsOnPage: true,
          customFields: {
            service_deliverables: 'Discovery workshop and implementation memo',
            delivery_timeline: 'Within 48 hours',
            support_contact: 'ops@example.test',
          },
        }),
      })

      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({
          templateId,
          status: 'draft',
          title: 'QA template custom field copy',
          customFieldsetCode: 'service_package',
        }),
      })
      linkId = link.id

      const stored = await readLink(request, token, link.id)
      expect(stored.customFields).toMatchObject({
        service_deliverables: 'Discovery workshop and implementation memo',
        delivery_timeline: 'Within 48 hours',
        support_contact: 'ops@example.test',
      })
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
      await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
    }
  })
})
