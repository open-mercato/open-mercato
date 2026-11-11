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
 * permission/loading behavior shipped in #7949, completing the browser
 * acceptance cases required by #8796: feature-gated tab visibility per
 * distinct logged-in user, cross-organization denial, independent
 * core-vs-attachment loading under delay/403/network failures, stale
 * attachment-response rejection after repeated claim and organization
 * navigation, the upload/Escape-cancel-delete/confirm-delete/count-recovery
 * flow (including a keyboard-only pass), a denied upload, and an
 * English/Polish desktop/mobile locale matrix. TC-WC-038 covers denied
 * reads at the API layer; the jsdom unit test
 * (__tests__/detail-attachment-access.test.tsx) covers one same-instance
 * claim-navigation race case — this file is the browser-level complement,
 * not a duplicate of either.
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
  const crossOrgReader = { email: `${stamp}-crossorg@test.invalid`, password: `Valid1!${randomUUID()}` }

  let adminToken: string
  let tenantId: string
  let organizationId: string
  let claimId: string | null = null
  let claimNumber: string
  let claimId2: string | null = null
  let claimNumber2: string
  let otherOrgId: string | null = null
  let otherOrgName: string
  let viewerRoleId: string | null = null
  let readerRoleId: string | null = null
  let wildcardRoleId: string | null = null
  let managerRoleId: string | null = null
  let outsiderRoleId: string | null = null
  let crossOrgReaderRoleId: string | null = null
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

    const claim2 = await createClaimFixture(request, adminToken, {
      claimType: 'warranty',
      customerName: `QA Browser Attachment Access ${stamp} Second`,
      reasonCode: 'defective',
      currencyCode: 'USD',
      lines: [{ lineNo: 1, productName: `QA Browser Part ${stamp} Second`, qtyClaimed: 1 }],
    })
    claimId2 = claim2.id!
    expect(claim2.claimNumber, 'second fixture claim should have a claim number').toBeTruthy()
    claimNumber2 = claim2.claimNumber!

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

    otherOrgName = `WC8796 Other Org ${stamp}`
    otherOrgId = await createOrganizationFixture(request, adminToken, { name: otherOrgName, tenantId })
    outsiderRoleId = await createRoleFixture(request, adminToken, { tenantId, name: `WC8796 Outsider ${stamp}` })
    await setRoleAclFeatures(request, adminToken, {
      roleId: outsiderRoleId,
      features: ['warranty_claims.claim.view', 'attachments.view'],
      organizations: [otherOrgId],
    })
    userIds.push(await createUserFixture(request, adminToken, {
      email: outsider.email, password: outsider.password, organizationId: otherOrgId, roles: [outsiderRoleId], name: 'WC8796 Outsider',
    }))

    // Visible in BOTH organizations — lets the organization-switcher race test
    // move the same user's selected org away from the claim's own org without
    // a full page reload (a single-org user would never see otherOrgId listed).
    crossOrgReaderRoleId = await createRoleFixture(request, adminToken, { tenantId, name: `WC8796 CrossOrg ${stamp}` })
    await setRoleAclFeatures(request, adminToken, {
      roleId: crossOrgReaderRoleId,
      features: ['warranty_claims.claim.view', 'attachments.view'],
      organizations: [organizationId, otherOrgId],
    })
    userIds.push(await createUserFixture(request, adminToken, {
      email: crossOrgReader.email, password: crossOrgReader.password, organizationId, roles: [crossOrgReaderRoleId], name: 'WC8796 CrossOrg',
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
    await deleteRoleIfExists(request, adminToken, crossOrgReaderRoleId)
    await deleteOrganizationIfExists(request, adminToken, otherOrgId)
    await cleanupDraftClaimWithLines(request, adminToken, claimId)
    await cleanupDraftClaimWithLines(request, adminToken, claimId2)
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
    let uploadedAttachmentId: string | null = null
    try {
      const uploadResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/attachments' && response.ok(),
      )
      await page.locator('input[type=file]').first().setInputFiles({
        name: fileName,
        mimeType: 'text/plain',
        buffer: Buffer.from('qa browser attachment content'),
      })
      const uploaded = await uploadResponse
      const uploadedBody = await uploaded.json().catch(() => null) as { item?: { id?: string } } | null
      uploadedAttachmentId = typeof uploadedBody?.item?.id === 'string' ? uploadedBody.item.id : null
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
      uploadedAttachmentId = null
      await expect(page.getByRole('link', { name: fileName })).toHaveCount(0)
      await expect(attachmentsTab.getByText('0')).toBeVisible()
    } finally {
      // A failed assertion anywhere above (count check, dialog state, etc.)
      // would otherwise skip the UI-driven DELETE and leave the upload
      // behind in a reused environment — clean it up idempotently here too.
      if (uploadedAttachmentId) {
        await page.request.delete(`/api/attachments?id=${encodeURIComponent(uploadedAttachmentId)}`).catch(() => undefined)
      }
    }
  })

  test('denies an upload for a user who only has attachments.view', async ({ page }) => {
    await loginAsScopedUser(page, reader.email, reader.password, tenantId, organizationId)
    await page.goto(`/backend/warranty_claims/${claimId}`)
    await expect(page.getByRole('tab', { name: /^Attachments/ })).toBeVisible()

    const response = await page.request.post('/api/attachments', {
      multipart: {
        entityId: 'warranty_claims:warranty_claim',
        recordId: claimId!,
        file: {
          name: `wc-8796-denied-${randomUUID().slice(0, 8)}.txt`,
          mimeType: 'text/plain',
          buffer: Buffer.from('should never be stored'),
        },
      },
    })
    expect(response.status(), 'a reader without attachments.manage must not be able to upload').toBe(403)
  })

  test('core claim details remain usable when the attachment request is forbidden', async ({ page }) => {
    await loginAsScopedUser(page, reader.email, reader.password, tenantId, organizationId)
    await page.route('**/api/attachments?*', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Forbidden', requiredFeatures: ['attachments.view'] }),
      })
    })

    await page.goto(`/backend/warranty_claims/${claimId}`)
    await expect(page.getByText(claimNumber, { exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: /^Lines/ })).toBeVisible()
    const attachmentsTab = page.getByRole('tab', { name: /^Attachments/ })
    await expect(attachmentsTab).toBeVisible()
    await expect(attachmentsTab.getByText('0')).toBeVisible()

    await page.unroute('**/api/attachments?*')
  })

  test('core claim details remain usable when the attachment request fails over the network', async ({ page }) => {
    await loginAsScopedUser(page, reader.email, reader.password, tenantId, organizationId)
    await page.route('**/api/attachments?*', async (route) => {
      await route.abort('failed')
    })

    await page.goto(`/backend/warranty_claims/${claimId}`)
    await expect(page.getByText(claimNumber, { exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: /^Lines/ })).toBeVisible()
    const attachmentsTab = page.getByRole('tab', { name: /^Attachments/ })
    await expect(attachmentsTab).toBeVisible()
    await expect(attachmentsTab.getByText('0')).toBeVisible()

    await page.unroute('**/api/attachments?*')
  })

  test('renders the Attachments tab with the localized label across desktop and mobile viewports', async ({ page, context, baseURL }) => {
    await loginAsScopedUser(page, reader.email, reader.password, tenantId, organizationId)
    const baseUrl = baseURL || process.env.BASE_URL || 'http://localhost:3000'
    const viewports = [
      { name: 'desktop', size: { width: 1280, height: 800 } },
      { name: 'mobile', size: { width: 390, height: 844 } },
    ]
    const locales: Array<{ code: string; label: string }> = [
      { code: 'en', label: 'Attachments' },
      { code: 'pl', label: 'Załączniki' },
    ]

    for (const viewport of viewports) {
      await page.setViewportSize(viewport.size)
      for (const locale of locales) {
        await context.addCookies([{ name: 'locale', value: locale.code, url: baseUrl, sameSite: 'Lax' as const }])
        await page.goto(`/backend/warranty_claims/${claimId}`)
        await expect(page.getByText(claimNumber, { exact: true })).toBeVisible()
        await expect(
          page.getByRole('tab', { name: new RegExp(`^${locale.label}`) }),
          `${viewport.name}/${locale.code}: the Attachments tab should render the localized label`,
        ).toBeVisible()
      }
    }
  })

  test('supports keyboard-only navigation to the Attachments tab and keyboard-only delete confirmation', async ({ page }) => {
    await loginAsScopedUser(page, manager.email, manager.password, tenantId, organizationId)
    await page.goto(`/backend/warranty_claims/${claimId}`)

    // Reach the Attachments tab via arrow-key roving-tabindex navigation only
    // (Lines -> Timeline -> Attachments); the TabsList keydown handler both
    // focuses and activates the target tab, so no .click() is ever used here.
    const linesTab = page.getByRole('tab', { name: /^Lines/ })
    await linesTab.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    const attachmentsTab = page.getByRole('tab', { name: /^Attachments/ })
    await expect(attachmentsTab).toHaveAttribute('aria-selected', 'true')

    const fileName = `wc-8796-kbd-${randomUUID().slice(0, 8)}.txt`
    let uploadedAttachmentId: string | null = null
    try {
      const uploadResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/attachments' && response.ok(),
      )
      await page.locator('input[type=file]').first().setInputFiles({
        name: fileName,
        mimeType: 'text/plain',
        buffer: Buffer.from('qa browser keyboard-only attachment content'),
      })
      const uploaded = await uploadResponse
      const uploadedBody = await uploaded.json().catch(() => null) as { item?: { id?: string } } | null
      uploadedAttachmentId = typeof uploadedBody?.item?.id === 'string' ? uploadedBody.item.id : null
      await expect(page.getByRole('link', { name: fileName })).toBeVisible()

      const deleteButton = page.getByRole('button', { name: `Delete ${fileName}` })
      await deleteButton.focus()
      await page.keyboard.press('Enter')
      const confirmDialog = page.getByRole('alertdialog')
      await expect(confirmDialog).toBeVisible()
      // The dialog auto-focuses Cancel; Tab moves to the destructive Delete
      // button next in DOM order, then Enter confirms — no .click() anywhere
      // in this confirmation sequence.
      await expect(confirmDialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(confirmDialog.getByRole('button', { name: 'Delete', exact: true })).toBeFocused()
      const deleteResponse = page.waitForResponse((response) =>
        response.request().method() === 'DELETE' && new URL(response.url()).pathname === '/api/attachments' && response.ok(),
      )
      await page.keyboard.press('Enter')
      await deleteResponse
      uploadedAttachmentId = null
      await expect(page.getByRole('link', { name: fileName })).toHaveCount(0)
    } finally {
      if (uploadedAttachmentId) {
        await page.request.delete(`/api/attachments?id=${encodeURIComponent(uploadedAttachmentId)}`).catch(() => undefined)
      }
    }
  })

  test('rejects a stale attachment response after repeatedly navigating between two claims (10 attempts)', async ({ page }) => {
    test.setTimeout(180_000)
    await loginAsScopedUser(page, reader.email, reader.password, tenantId, organizationId)
    await page.goto(`/backend/warranty_claims?search=${encodeURIComponent(stamp)}`)
    const rowFor = (number: string) => page.getByRole('row').filter({ hasText: number })
    await expect(rowFor(claimNumber)).toBeVisible()
    await expect(rowFor(claimNumber2)).toBeVisible()

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const releaseGate: { resolve: (() => void) | null } = { resolve: null }
      let captured = false
      await page.route('**/api/attachments?*', async (route) => {
        if (!captured) {
          captured = true
          await new Promise<void>((resolve) => { releaseGate.resolve = resolve })
        }
        await route.continue()
      })

      await rowFor(claimNumber).click()
      await expect(page.getByText(claimNumber, { exact: true })).toBeVisible()
      await expect(page.getByRole('tab', { name: /^Attachments/ })).toBeVisible()

      // Navigate away to the second claim WITHOUT releasing the gate yet, so
      // the first claim's attachments fetch is still in flight when its
      // component context has already moved on to the second claim.
      await page.goBack()
      await expect(rowFor(claimNumber2)).toBeVisible()
      await rowFor(claimNumber2).click()
      await expect(page.getByText(claimNumber2, { exact: true })).toBeVisible()
      const secondAttachmentsTab = page.getByRole('tab', { name: /^Attachments/ })
      await expect(secondAttachmentsTab).toBeVisible()
      await expect(secondAttachmentsTab.getByText('0')).toBeVisible()

      releaseGate.resolve?.()
      await expect(
        secondAttachmentsTab.getByText('0'),
        `attempt ${attempt + 1}: the first claim's stale attachment response must not leak into the second claim's count`,
      ).toBeVisible()
      await expect(page.getByText(claimNumber, { exact: true })).toHaveCount(0)

      await page.unroute('**/api/attachments?*')
      await page.goBack()
      await expect(rowFor(claimNumber)).toBeVisible()
    }
  })

  test('rejects a stale attachment response after switching the selected organization mid-flight', async ({ page }) => {
    await loginAsScopedUser(page, crossOrgReader.email, crossOrgReader.password, tenantId, organizationId)

    const releaseGate: { resolve: (() => void) | null } = { resolve: null }
    let captured = false
    await page.route('**/api/attachments?*', async (route) => {
      if (!captured) {
        captured = true
        await new Promise<void>((resolve) => { releaseGate.resolve = resolve })
      }
      await route.continue()
    })

    await page.goto(`/backend/warranty_claims/${claimId}`)
    await expect(page.getByText(claimNumber, { exact: true })).toBeVisible()
    const attachmentsTab = page.getByRole('tab', { name: /^Attachments/ })
    await expect(attachmentsTab).toBeVisible()
    await expect(attachmentsTab.getByText('0')).toBeVisible()

    // Switch the selected organization through the real chrome switcher
    // (writes the om_selected_org cookie and bumps the client-side scope
    // version via emitOrganizationScopeChanged) WITHOUT a page reload, while
    // the gated attachments response for the original org is still pending.
    await page.getByRole('button', { name: /^Organization:/ }).click()
    await page.getByRole('button', { name: otherOrgName, exact: true }).click()
    await expect(page.getByText('Claim not found.')).toBeVisible()

    releaseGate.resolve?.()
    await expect(
      page.getByText('Claim not found.'),
      'a stale attachment response from the previously-selected organization must not resurrect the claim view',
    ).toBeVisible()
    await expect(page.getByText(claimNumber, { exact: true })).toHaveCount(0)

    await page.unroute('**/api/attachments?*')
  })
})
