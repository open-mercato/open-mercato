import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createFixedTemplateInput,
  createTemplateFixture,
  deleteCheckoutEntityIfExists,
} from './helpers/fixtures'

test('TC-CHKT-048: the template preview loads from the back office origin and shows payments disabled', async ({ page, request }) => {
  const token = await getAuthToken(request, 'admin')
  const title = `QA checkout template preview ${Date.now()}`
  const template = createFixedTemplateInput({ title, collectCustomerDetails: false })
  const templateId = await createTemplateFixture(request, token, template)

  try {
    await login(page, 'admin')
    const encodedTemplateId = encodeURIComponent(templateId)
    const previewPath = `/backend/checkout/templates/${encodedTemplateId}/preview`
    const apiPath = `/api/checkout/templates/${encodedTemplateId}/preview`

    const [previewResponse] = await Promise.all([
      page.waitForResponse((response) =>
        response.request().method() === 'GET' && new URL(response.url()).pathname === apiPath),
      page.goto(previewPath),
    ])

    expect(previewResponse.status()).toBe(200)
    expect(new URL(previewResponse.url()).origin).toBe(new URL(page.url()).origin)
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(page.getByText('Preview mode. Payments are disabled.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Preview only', exact: true })).toBeDisabled()
  } finally {
    await deleteCheckoutEntityIfExists(request, token, 'templates', templateId)
  }
})
