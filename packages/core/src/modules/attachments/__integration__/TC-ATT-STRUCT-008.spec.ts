import { expect, test, type Page } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { deleteAttachmentIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenScope } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { buildDocumentSectionHref } from '@open-mercato/core/modules/attachments/lib/documentStructure/sectionLink'
import {
  PAST_PERFORMANCE_PHRASE,
  STRUCTURE_TEST_TIMEOUT_MS,
  buildRulebookPdf,
  deletePartitionQuietly,
  extractAndWait,
  prepareStructurePartition,
  readSections,
  uploadStructureDocument,
  type StructurePartition,
} from './helpers/documentStructure'

/**
 * TC-ATT-STRUCT-008: an attachment citation opens the cited section
 * Source: B-9 in the #8251 coverage audit (feature 40, "answers cite the exact document section").
 * Surfaces: /backend/storage/attachments/:id/sections/:anchorKey (the href that
 * attachments.get_document_sections puts on every citation), backed by
 * GET /api/attachments/structure/:id/sections?anchorKey=.
 *
 * The page re-checks access through the scoped structure API: a user of another organization
 * of the same tenant, holding attachments.view, gets "not found" for the same link.
 */

const PASSWORD = 'Valid1!Pass'
const UNKNOWN_ANCHOR = 'ffffffffffffffffffffffffffffffff'

async function loginWithCredentials(page: Page, email: string, password: string, token: string): Promise<void> {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  const { tenantId, organizationId } = getTokenScope(token)
  await page.context().addCookies([
    { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
    { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
    { name: 'om_feedback_suppress', value: '1', url: baseUrl, sameSite: 'Lax' },
    { name: 'om_selected_tenant', value: tenantId, url: baseUrl, sameSite: 'Lax' },
    { name: 'om_selected_org', value: organizationId, url: baseUrl, sameSite: 'Lax' },
  ])
  const form = new URLSearchParams({ email, password })
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  expect(response.ok(), `POST /api/auth/login returned ${response.status()}`).toBe(true)
  await page.goto('/backend', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/backend(?:\/.*)?$/)
}

test.describe('TC-ATT-STRUCT-008: citation deep link to a document section', () => {
  test('opens the cited section for its organization and nothing for another one', async ({ page, request }) => {
    test.setTimeout(STRUCTURE_TEST_TIMEOUT_MS)
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenScope(adminToken)
    const stamp = `tc-att-struct-008-${Date.now()}`

    let partition: StructurePartition | null = null
    let attachmentId: string | null = null
    let otherOrgId: string | null = null
    let outsiderRoleId: string | null = null
    let outsiderUserId: string | null = null

    try {
      partition = await prepareStructurePartition(request, adminToken, 'citation')
      attachmentId = await uploadStructureDocument(request, adminToken, partition, {
        fileName: `${stamp}.pdf`,
        mimeType: 'application/pdf',
        buffer: await buildRulebookPdf(),
      })
      const structure = await extractAndWait(request, adminToken, attachmentId, partition)
      expect(structure.extraction?.status).toBe('completed')
      const clause = await readSections(request, adminToken, attachmentId, '?numberLabel=8.12&includeText=false')
      expect(clause.status).toBe(200)
      const anchorKey = clause.body?.items[0]?.anchorKey
      expect(anchorKey, 'section 8.12 should have an anchor key').toMatch(/^[0-9a-f]{32}$/)
      const sectionHref = buildDocumentSectionHref(attachmentId, anchorKey!)

      await login(page, 'admin')
      await page.goto(sectionHref, { waitUntil: 'domcontentloaded' })
      const cited = page.getByTestId('attachment-cited-section')
      await expect(cited).toBeVisible({ timeout: 20_000 })
      await expect(cited).toContainText(PAST_PERFORMANCE_PHRASE)
      await expect(page.getByRole('heading', { level: 1 })).toContainText('8.12 Past performance')
      await expect(page.getByText('p. 3', { exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Download document' })).toHaveAttribute(
        'href',
        `/api/attachments/file/${attachmentId}?download=1`,
      )
      await test.info().attach('cited-section-admin', {
        body: await page.screenshot({ fullPage: false }),
        contentType: 'image/png',
      })

      await page.goto(buildDocumentSectionHref(attachmentId, UNKNOWN_ANCHOR), { waitUntil: 'domcontentloaded' })
      await expect(page.getByText('Cited section not found', { exact: true })).toBeVisible({ timeout: 20_000 })

      otherOrgId = await createOrganizationFixture(request, superadminToken, { name: `QA Citation Other Org ${stamp}`, tenantId })
      outsiderRoleId = await createRoleFixture(request, superadminToken, { tenantId, name: `QA Citation Outsider ${stamp}` })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: outsiderRoleId,
        features: ['attachments.view'],
        organizations: [otherOrgId],
      })
      const outsiderEmail = `${stamp}-outsider@test.invalid`
      outsiderUserId = await createUserFixture(request, superadminToken, {
        email: outsiderEmail,
        password: PASSWORD,
        organizationId: otherOrgId,
        roles: [outsiderRoleId],
        name: `QA Citation Outsider ${stamp}`,
      })
      const outsiderToken = await getAuthToken(request, outsiderEmail, PASSWORD)
      const outsiderApi = await readSections(request, outsiderToken, attachmentId, `?anchorKey=${anchorKey}`)
      expect(outsiderApi.status, 'another organization must not read the cited section').toBe(404)

      await page.context().clearCookies()
      await loginWithCredentials(page, outsiderEmail, PASSWORD, outsiderToken)
      await page.goto(sectionHref, { waitUntil: 'domcontentloaded' })
      await expect(page.getByText('Cited section not found', { exact: true })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText(PAST_PERFORMANCE_PHRASE)).toHaveCount(0)
      await test.info().attach('cited-section-other-organization', {
        body: await page.screenshot({ fullPage: false }),
        contentType: 'image/png',
      })
    } finally {
      await deleteAttachmentIfExists(request, adminToken, attachmentId)
      await deletePartitionQuietly(request, adminToken, partition)
      await deleteUserIfExists(request, superadminToken, outsiderUserId)
      await deleteRoleIfExists(request, superadminToken, outsiderRoleId)
      await deleteOrganizationIfExists(request, superadminToken, otherOrgId)
    }
  })
})
