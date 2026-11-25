import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import {
  createPublishedFormFixture,
  deleteFormIfExists,
  forkDraftFixture,
  portalCall,
  publishVersionFixture,
  waitForAutosaveWindow,
} from '@open-mercato/core/helpers/integration/formsFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test('TC-FORMS-PORTAL-003: portal resume offers saved progress for the opened form', async ({ baseURL, page, request }) => {
  const stamp = randomUUID()
  const answer = `Saved answer ${stamp}`
  const adminToken = await getAuthToken(request, 'admin')
  const { tenantId, organizationId } = getTokenContext(adminToken)
  let progressFormId: string | null = null
  let blankFormId: string | null = null
  let customerId: string | null = null

  try {
    const orgResponse = await apiRequest(request, 'GET',
      `/api/directory/organizations?view=manage&ids=${encodeURIComponent(organizationId)}&tenantId=${encodeURIComponent(tenantId)}`,
      { token: adminToken })
    expect(orgResponse.ok()).toBe(true)
    const organizations = await readJsonSafe<{ items: Array<{ slug: string }> }>(orgResponse)
    const orgSlug = organizations?.items[0]?.slug
    expect(orgSlug).toBeTruthy()

    const progressForm = await createPublishedFormFixture(request, adminToken, { name: `Progress ${stamp}` })
    progressFormId = progressForm.formId
    const blankForm = await createPublishedFormFixture(request, adminToken, { name: `Blank ${stamp}` })
    blankFormId = blankForm.formId
    const customer = await createCustomerUserFixture(request, adminToken, {
      email: `qa-forms-resume-${stamp}@test.local`,
      displayName: 'Forms resume QA',
    })
    customerId = customer.id
    const session = await portalLogin(request, { email: customer.email, password: customer.password, tenantId })
    const cookies = portalCookieHeaders(session)

    const started = await portalCall(request, 'POST', '/api/forms/form-submissions', {
      cookies,
      data: { form_key: progressForm.formKey, subject_type: 'customer', subject_id: customer.id },
    })
    expect(started.status()).toBe(201)
    const draft = await readJsonSafe<{ submission: { id: string }; revision: { id: string } }>(started)
    expect(draft).toBeTruthy()
    const { submission, revision } = draft!
    await waitForAutosaveWindow()
    const saved = await portalCall(request, 'PATCH', `/api/forms/form-submissions/${submission.id}`, {
      cookies,
      data: { base_revision_id: revision.id, patch: { full_name: answer } },
    })
    expect(saved.status()).toBe(200)

    const latestVersion = await forkDraftFixture(request, adminToken, progressForm.formId)
    await publishVersionFixture(request, adminToken, progressForm.formId, latestVersion, 'Publish the next version')

    await page.context().addCookies([
      { name: 'customer_auth_token', value: session.authToken, url: baseURL!, sameSite: 'Lax' },
      { name: 'customer_session_token', value: session.sessionToken, url: baseURL!, sameSite: 'Lax' },
    ])
    const nameField = page.getByRole('textbox', { name: 'Full name', exact: true })
    const continueButton = page.getByRole('button', { name: 'Continue filling' })

    await page.goto(`/${orgSlug}/portal/forms/${blankForm.formKey}`)
    await expect(nameField).toHaveValue('')
    await page.reload()
    await expect(nameField).toHaveValue('')
    await expect(continueButton).toHaveCount(0)

    await page.goto(`/${orgSlug}/portal/forms/${progressForm.formKey}`)
    await continueButton.click()
    await expect(nameField).toHaveValue(answer)

    await page.goto(`/${orgSlug}/portal/submissions/${submission.id}/continue?formKey=${encodeURIComponent(progressForm.formKey)}`)
    await expect(nameField).toHaveValue(answer)
  } finally {
    await deleteCustomerUserFixture(request, adminToken, customerId)
    await deleteFormIfExists(request, adminToken, blankFormId)
    await deleteFormIfExists(request, adminToken, progressFormId)
  }
})
