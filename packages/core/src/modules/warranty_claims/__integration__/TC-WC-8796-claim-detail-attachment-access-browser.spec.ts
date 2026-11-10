import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { cleanupDraftClaimWithLines, createClaimFixture, uniqueLabel } from './helpers'

/**
 * TC-WC-8796: real-browser coverage for the claim-detail attachment-access
 * permission/loading behavior shipped in #7949. The API-only TC-WC-038 spec
 * and the jsdom unit test (__tests__/detail-attachment-access.test.tsx)
 * already exercise the exhaustive stale-response race and the full
 * locale/viewport matrix, so this spec focuses on what only a real browser
 * session can prove: feature-gated tab visibility per distinct logged-in
 * user, cross-organization denial, independent core-vs-attachment loading,
 * and the upload/Escape-cancel-delete/confirm-delete interaction.
 */

async function loginAsScopedUser(
  page: Page,
  email: string,
  password: string,
  tenantId: string,
  organizationId: string,
): Promise<void> {
  const form = new URLSearchParams()
  form.set('email', email)
  form.set('password', password)
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  expect(response.ok(), `login should succeed for ${email}: ${response.status()}`).toBeTruthy()
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  await page.context().addCookies([
    { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' as const },
    { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' as const },
    { name: 'om_feedback_suppress', value: '1', url: baseUrl, sameSite: 'Lax' as const },
    { name: 'om_selected_tenant', value: tenantId, url: baseUrl, sameSite: 'Lax' as const },
    { name: 'om_selected_org', value: organizationId, url: baseUrl, sameSite: 'Lax' as const },
  ])
}

test.describe('TC-WC-8796: claim detail attachment access in the browser', () => {
  test.slow()

  const stamp = uniqueLabel('wc-8796')
  const viewer = { email: `${stamp}-viewer@test.invalid`, password: `Valid1!${randomUUID()}` }
  const reader = { email: `${stamp}-reader@test.invalid`, password: `Valid1!${randomUUID()}` }
  const wildcard = { email: `${stamp}-wildcard@test.invalid`, password: `Valid1!${randomUUID()}` }
  const manager = { email: `${stamp}-manager@test.invalid`, password: `Valid1!${randomUUID()}` }
  const outsider = { email: `${stamp}-outsider@test.invalid`, password: `Valid1!${randomUUID()}` }

  let adminToken: string
  let tenantId: string
  let organizationId: string
  let claimId: string | null = null
  let claimNumber: string
  let otherOrgId: string | null = null
  let viewerRoleId: string | null = null
  let readerRoleId: string | null = null
  let wildcardRoleId: string | null = null
  let managerRoleId: string | null = null
  let outsiderRoleId: string | null = null
  const userIds: string[] = []

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenContext(adminToken)
    tenantId = scope.tenantId
    organizationId = scope.organizationId

    const claim = await createClaimFixture(request, adminToken, {
      claimType: 'warranty',
      customerName: `QA Browser Attachment Access ${stamp}`,
      reasonCode: 'defective',
      currencyCode: 'USD',
      lines: [{ lineNo: 1, productName: `QA Browser Part ${stamp}`, qtyClaimed: 1 }],
    })
    claimId = claim.id!
    expect(claim.claimNumber, 'fixture claim should have a claim number').toBeTruthy()
    claimNumber = claim.claimNumber!

    viewerRoleId = await createRoleFixture(request, adminToken, { tenantId, name: `WC8796 Viewer ${stamp}` })
    await setRoleAclFeatures(request, adminToken, {
      roleId: viewerRoleId,
      features: ['warranty_claims.claim.view'],
      organizations: [organizationId],
    })
    userIds.push(await createUserFixture(request, adminToken, {
      email: viewer.email, password: viewer.password, organizationId, roles: [viewerRoleId], name: 'WC8796 Viewer',
    }))

    readerRoleId = await createRoleFixture(request, adminToken, { tenantId, name: `WC8796 Reader ${stamp}` })
    await setRoleAclFeatures(request, adminToken, {
      roleId: readerRoleId,
      features: ['warranty_claims.claim.view', 'attachments.view'],
      organizations: [organizationId],
    })
    userIds.push(await createUserFixture(request, adminToken, {
      email: reader.email, password: reader.password, organizationId, roles: [readerRoleId], name: 'WC8796 Reader',
    }))

    wildcardRoleId = await createRoleFixture(request, adminToken, { tenantId, name: `WC8796 Wildcard ${stamp}` })
    await setRoleAclFeatures(request, adminToken, {
      roleId: wildcardRoleId,
      features: ['warranty_claims.claim.view', 'attachments.*'],
      organizations: [organizationId],
    })
    userIds.push(await createUserFixture(request, adminToken, {
      email: wildcard.email, password: wildcard.password, organizationId, roles: [wildcardRoleId], name: 'WC8796 Wildcard',
    }))

    managerRoleId = await createRoleFixture(request, adminToken, { tenantId, name: `WC8796 Manager ${stamp}` })
    await setRoleAclFeatures(request, adminToken, {
      roleId: managerRoleId,
      features: ['warranty_claims.claim.view', 'warranty_claims.claim.manage', 'attachments.view', 'attachments.manage'],
      organizations: [organizationId],
    })
    userIds.push(await createUserFixture(request, adminToken, {
      email: manager.email, password: manager.password, organizationId, roles: [managerRoleId], name: 'WC8796 Manager',
    }))

    otherOrgId = await createOrganizationFixture(request, adminToken, { name: `WC8796 Other Org ${stamp}`, tenantId })
    outsiderRoleId = await createRoleFixture(request, adminToken, { tenantId, name: `WC8796 Outsider ${stamp}` })
    await setRoleAclFeatures(request, adminToken, {
      roleId: outsiderRoleId,
      features: ['warranty_claims.claim.view', 'attachments.view'],
      organizations: [otherOrgId],
    })
    userIds.push(await createUserFixture(request, adminToken, {
      email: outsider.email, password: outsider.password, organizationId: otherOrgId, roles: [outsiderRoleId], name: 'WC8796 Outsider',
    }))
  })

  test.afterAll(async ({ request }) => {
    for (const userId of userIds) {
      await deleteUserIfExists(request, adminToken, userId)
    }
    await deleteRoleIfExists(request, adminToken, viewerRoleId)
    await deleteRoleIfExists(request, adminToken, readerRoleId)
    await deleteRoleIfExists(request, adminToken, wildcardRoleId)
    await deleteRoleIfExists(request, adminToken, managerRoleId)
    await deleteRoleIfExists(request, adminToken, outsiderRoleId)
    await deleteOrganizationIfExists(request, adminToken, otherOrgId)
    await cleanupDraftClaimWithLines(request, adminToken, claimId)
  })

  test('a claim-only viewer sees core details and never requests attachments', async ({ page }) => {
    await loginAsScopedUser(page, viewer.email, viewer.password, tenantId, organizationId)
    const attachmentRequests: string[] = []
    page.on('request', (req) => {
      if (new URL(req.url()).pathname === '/api/attachments') attachmentRequests.push(req.url())
    })

    await page.goto(`/backend/warranty_claims/${claimId}`)
    await expect(page.getByText(claimNumber, { exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: /^Lines/ })).toBeVisible()
    await expect(page.getByRole('tab', { name: /^Timeline/ })).toBeVisible()
    await expect(page.getByRole('tab', { name: /^Attachments/ })).toHaveCount(0)
    expect(attachmentRequests, 'a claim-only viewer must never trigger an attachments request').toHaveLength(0)
  })

  test('an explicit attachments.view reader sees the Attachments tab', async ({ page }) => {
    await loginAsScopedUser(page, reader.email, reader.password, tenantId, organizationId)
    await page.goto(`/backend/warranty_claims/${claimId}`)
    await expect(page.getByText(claimNumber, { exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: /^Attachments/ })).toBeVisible()
  })

  test('a wildcard attachments.* reader sees the Attachments tab', async ({ page }) => {
    await loginAsScopedUser(page, wildcard.email, wildcard.password, tenantId, organizationId)
    await page.goto(`/backend/warranty_claims/${claimId}`)
    await expect(page.getByText(claimNumber, { exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: /^Attachments/ })).toBeVisible()
  })

  test('a user from another organization cannot reach the claim', async ({ page }) => {
    await loginAsScopedUser(page, outsider.email, outsider.password, tenantId, otherOrgId!)
    await page.goto(`/backend/warranty_claims/${claimId}`)
    await expect(page.getByText(claimNumber, { exact: true })).toHaveCount(0)
    await expect(page.getByText('Claim not found.')).toBeVisible()
  })

  test('core claim details render while the optional attachment count is still pending', async ({ page }) => {
    await loginAsScopedUser(page, reader.email, reader.password, tenantId, organizationId)
    const releaseGate: { resolve: (() => void) | null } = { resolve: null }
    let firstRequestCaptured = false
    await page.route('**/api/attachments?*', async (route) => {
      if (!firstRequestCaptured) {
        firstRequestCaptured = true
        await new Promise<void>((resolve) => { releaseGate.resolve = resolve })
      }
      await route.continue()
    })
    const attachmentsResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/attachments',
    )

    await page.goto(`/backend/warranty_claims/${claimId}`)
    await expect(page.getByText(claimNumber, { exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: /^Lines/ })).toBeVisible()
    const attachmentsTab = page.getByRole('tab', { name: /^Attachments/ })
    await expect(attachmentsTab).toBeVisible()
    await expect(attachmentsTab.getByText('0')).toBeVisible()

    releaseGate.resolve?.()
    await attachmentsResponse
    await page.unroute('**/api/attachments?*')
  })

  test('upload, Escape-cancel delete, confirmed delete and count recovery', async ({ page }) => {
    await loginAsScopedUser(page, manager.email, manager.password, tenantId, organizationId)
    await page.goto(`/backend/warranty_claims/${claimId}`)
    const attachmentsTab = page.getByRole('tab', { name: /^Attachments/ })
    await attachmentsTab.click()

    const fileName = `wc-8796-${randomUUID().slice(0, 8)}.txt`
    const uploadResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/attachments' && response.ok(),
    )
    await page.locator('input[type=file]').first().setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('qa browser attachment content'),
    })
    await uploadResponse
    await expect(page.getByRole('link', { name: fileName })).toBeVisible()
    await expect(attachmentsTab.getByText('1')).toBeVisible()

    const deleteButton = page.getByRole('button', { name: `Delete ${fileName}` })
    await deleteButton.click()
    const confirmDialog = page.getByRole('alertdialog')
    await expect(confirmDialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(confirmDialog).toHaveCount(0)
    await expect(page.getByRole('link', { name: fileName }), 'Escape must cancel the delete, keeping the file').toBeVisible()
    await expect(attachmentsTab.getByText('1')).toBeVisible()

    await deleteButton.click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    const deleteResponse = page.waitForResponse((response) =>
      response.request().method() === 'DELETE' && new URL(response.url()).pathname === '/api/attachments' && response.ok(),
    )
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await deleteResponse
    await expect(page.getByRole('link', { name: fileName })).toHaveCount(0)
    await expect(attachmentsTab.getByText('0')).toBeVisible()
  })
})
