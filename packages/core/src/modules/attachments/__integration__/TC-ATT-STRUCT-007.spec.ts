import { expect, test, type Locator, type Page } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { deleteAttachmentIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenScope } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  STRUCTURE_TEST_TIMEOUT_MS,
  buildRulebookPdf,
  deletePartitionQuietly,
  extractAndWait,
  prepareStructurePartition,
  uploadStructureDocument,
  type StructurePartition,
} from './helpers/documentStructure'

/**
 * TC-ATT-STRUCT-007: the attachment dialog shows the document structure panel
 * Source spec: .ai/specs/2026-10-21-document-structure-extraction.md (Testing Strategy)
 * Surfaces: /backend/storage/attachments row click -> AttachmentMetadataDialog "Structure" tab
 * (DocumentStructurePanel), backed by GET /api/attachments/structure/:id.
 *
 * Chapters are outline roots, so they render expanded with their clauses inlined. The panel
 * shows the "Re-extract" action only to callers holding attachments.manage.
 */

const LIBRARY_PATH = '/backend/storage/attachments'
const CHAPTER_LABEL = 'Chapter 8 Financial Promotions'
const CLAUSE_LABEL = '8.12 Past performance'

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
  expect(response.ok(), `POST /api/auth/login for the viewer returned ${response.status()}`).toBe(true)
  await page.goto('/backend', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/backend(?:\/.*)?$/)
}

async function openStructureTab(page: Page, fileName: string): Promise<Locator> {
  await page.goto(LIBRARY_PATH, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder(/Search files/i).first().fill(fileName)
  const row = page.getByText(fileName, { exact: true }).first()
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: 'Structure', exact: true }).click()
  const panel = dialog.getByTestId('document-structure-panel')
  await expect(panel).toBeVisible({ timeout: 20_000 })
  await expect(panel.getByText('Completed', { exact: true })).toBeVisible()
  await expect(panel.getByText(CHAPTER_LABEL, { exact: true })).toBeVisible()
  return panel
}

async function toggleChapterAndSeeClause(panel: Locator): Promise<void> {
  const collapse = panel.getByRole('button', { name: `Collapse ${CHAPTER_LABEL}`, exact: true })
  await expect(collapse).toHaveAttribute('aria-expanded', 'true')
  await expect(panel.getByText(CLAUSE_LABEL, { exact: true })).toBeVisible()
  await collapse.click()
  await expect(panel.getByText(CLAUSE_LABEL, { exact: true })).toHaveCount(0)
  const expand = panel.getByRole('button', { name: `Expand ${CHAPTER_LABEL}`, exact: true })
  await expect(expand).toHaveAttribute('aria-expanded', 'false')
  await expand.click()
  await expect(panel.getByRole('button', { name: `Collapse ${CHAPTER_LABEL}`, exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(panel.getByText(CLAUSE_LABEL, { exact: true })).toBeVisible()
}

test.describe('TC-ATT-STRUCT-007: document structure panel in the attachment dialog', () => {
  test('shows the outline to viewers and the Re-extract action only to managers', async ({ page, request }) => {
    test.setTimeout(STRUCTURE_TEST_TIMEOUT_MS)
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId, organizationId } = getTokenScope(adminToken)
    const stamp = `tc-att-struct-007-${Date.now()}`
    const fileName = `${stamp}.pdf`
    const password = 'Valid1!Pass'

    let partition: StructurePartition | null = null
    let attachmentId: string | null = null
    let viewerRoleId: string | null = null
    let viewerUserId: string | null = null

    try {
      partition = await prepareStructurePartition(request, adminToken, 'panel')
      attachmentId = await uploadStructureDocument(request, adminToken, partition, {
        fileName,
        mimeType: 'application/pdf',
        buffer: await buildRulebookPdf(),
      })
      const structure = await extractAndWait(request, adminToken, attachmentId, partition)
      expect(structure.extraction?.status).toBe('completed')

      await login(page, 'admin')
      const adminPanel = await openStructureTab(page, fileName)
      await toggleChapterAndSeeClause(adminPanel)
      await expect(adminPanel.getByRole('button', { name: 'Re-extract', exact: true })).toBeVisible()
      await test.info().attach('structure-panel-admin', {
        body: await page.screenshot({ fullPage: false }),
        contentType: 'image/png',
      })

      viewerRoleId = await createRoleFixture(request, superadminToken, { tenantId, name: `QA Struct Panel Viewer ${stamp}` })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: viewerRoleId,
        features: ['attachments.view'],
        organizations: [organizationId],
      })
      const viewerEmail = `${stamp}-viewer@test.invalid`
      viewerUserId = await createUserFixture(request, superadminToken, {
        email: viewerEmail,
        password,
        organizationId,
        roles: [viewerRoleId],
        name: `QA Struct Panel Viewer ${stamp}`,
      })
      const viewerToken = await getAuthToken(request, viewerEmail, password)

      await page.context().clearCookies()
      await loginWithCredentials(page, viewerEmail, password, viewerToken)
      const viewerPanel = await openStructureTab(page, fileName)
      await toggleChapterAndSeeClause(viewerPanel)
      await expect(viewerPanel.getByRole('button', { name: 'Re-extract', exact: true })).toHaveCount(0)
      await expect(viewerPanel.getByRole('button', { name: 'Extract structure', exact: true })).toHaveCount(0)
      await test.info().attach('structure-panel-viewer', {
        body: await page.screenshot({ fullPage: false }),
        contentType: 'image/png',
      })
    } finally {
      await deleteAttachmentIfExists(request, adminToken, attachmentId)
      await deletePartitionQuietly(request, adminToken, partition)
      await deleteUserIfExists(request, superadminToken, viewerUserId)
      await deleteRoleIfExists(request, superadminToken, viewerRoleId)
    }
  })
})
