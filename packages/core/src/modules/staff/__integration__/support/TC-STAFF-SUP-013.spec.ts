/**
 * TC-STAFF-SUP-013: Support ticket attachments.
 *
 * Customers upload files on the new-ticket form and on the ticket; staff upload files
 * and choose whether the customer may see them; customers can only delete their own
 * uploads; a ticket of another company is never reachable.
 */
import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { deleteAttachmentIfExists, uploadAttachmentFixture } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { portalCookieHeaders } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  Cleanup,
  PORTAL_MANAGE,
  PORTAL_VIEW,
  adminToken,
  cleanupTicketAttachments,
  createCategory,
  createPortalCustomer,
  createProject,
  deleteTask,
  dismissNotices,
  fileTicket,
  pointFallbackAt,
  resolveOrgSlug,
  usePortalSessionInBrowser,
  type PortalCustomer,
} from './fixtures'

type PortalAttachment = { id: string; fileName: string; uploadedByCustomer: boolean; canDelete: boolean; downloadUrl: string }

async function listPortalAttachments(
  request: import('@playwright/test').APIRequestContext,
  customer: PortalCustomer,
  taskId: string,
): Promise<{ status: number; items: PortalAttachment[] }> {
  const response = await request.get(`/api/staff/portal/support-tickets/${taskId}/attachments`, {
    headers: portalCookieHeaders(customer.session),
  })
  const body = await readJsonSafe<{ items?: PortalAttachment[] }>(response)
  return { status: response.status(), items: body?.items ?? [] }
}

async function uploadAsCustomer(
  request: import('@playwright/test').APIRequestContext,
  customer: PortalCustomer,
  taskId: string,
  fileName: string,
) {
  return request.fetch(`/api/staff/portal/support-tickets/${taskId}/attachments`, {
    method: 'POST',
    headers: portalCookieHeaders(customer.session),
    multipart: { file: { name: fileName, mimeType: 'text/plain', buffer: Buffer.from(`contents of ${fileName}`) } },
  })
}

test.describe('TC-STAFF-SUP-013: Support ticket attachments', () => {
  test('customers and staff exchange files with visibility and ownership rules', async ({ request }) => {
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const project = await createProject(request, admin, cleanup, 'files')
      await pointFallbackAt(request, admin, cleanup, project.id)
      const category = await createCategory(request, admin, cleanup, 'files')
      const buyer = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'files-buyer' })
      const colleague = await createPortalCustomer(request, admin, cleanup, {
        features: [PORTAL_VIEW, PORTAL_MANAGE],
        companyId: buyer.companyId,
        label: 'files-colleague',
      })
      const stranger = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'files-stranger' })
      const ticket = await fileTicket(request, buyer, { categoryValue: category.value })
      cleanup.add(() => deleteTask(request, admin, ticket.id))
      cleanupTicketAttachments(request, admin, cleanup, ticket.id)

      const upload = await uploadAsCustomer(request, buyer, ticket.id, 'error-log.txt')
      expect(upload.status()).toBe(201)

      const shared = await uploadAttachmentFixture(request, admin, {
        entityId: 'staff:staff_time_task',
        recordId: ticket.id,
        fileName: 'fix-instructions.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Restart the export service.'),
        tags: ['customer-visible'],
      })
      cleanup.add(() => deleteAttachmentIfExists(request, admin, shared.id))
      const internal = await uploadAttachmentFixture(request, admin, {
        entityId: 'staff:staff_time_task',
        recordId: ticket.id,
        fileName: 'internal-analysis.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Root cause: batch size constant.'),
      })
      cleanup.add(() => deleteAttachmentIfExists(request, admin, internal.id))

      const buyerView = await listPortalAttachments(request, buyer, ticket.id)
      expect(buyerView.status).toBe(200)
      const names = buyerView.items.map((item) => item.fileName)
      expect(names).toEqual(expect.arrayContaining(['error-log.txt', 'fix-instructions.txt']))
      expect(names).not.toContain('internal-analysis.txt')
      const own = buyerView.items.find((item) => item.fileName === 'error-log.txt')!
      const staffFile = buyerView.items.find((item) => item.fileName === 'fix-instructions.txt')!
      expect(own.canDelete).toBe(true)
      expect(own.uploadedByCustomer).toBe(true)
      expect(staffFile.canDelete).toBe(false)

      const download = await request.get(staffFile.downloadUrl, { headers: portalCookieHeaders(buyer.session) })
      expect(download.status()).toBe(200)
      expect((await download.body()).toString()).toContain('Restart the export service.')
      const internalDownload = await request.get(
        `/api/staff/portal/support-tickets/${ticket.id}/attachments?attachmentId=${internal.id}`,
        { headers: portalCookieHeaders(buyer.session) },
      )
      expect(internalDownload.status()).toBe(404)

      const staffList = await apiRequest(
        request,
        'GET',
        `/api/attachments?entityId=${encodeURIComponent('staff:staff_time_task')}&recordId=${ticket.id}`,
        { token: admin },
      )
      const staffNames = ((await readJsonSafe<{ items?: Array<{ fileName: string }> }>(staffList))?.items ?? []).map((item) => item.fileName)
      expect(staffNames).toEqual(expect.arrayContaining(['error-log.txt', 'fix-instructions.txt', 'internal-analysis.txt']))

      const colleagueView = await listPortalAttachments(request, colleague, ticket.id)
      const colleagueCopy = colleagueView.items.find((item) => item.fileName === 'error-log.txt')!
      expect(colleagueCopy.canDelete).toBe(false)
      const colleagueDelete = await request.delete(`/api/staff/portal/support-tickets/${ticket.id}/attachments?attachmentId=${own.id}`, {
        headers: portalCookieHeaders(colleague.session),
      })
      expect(colleagueDelete.status()).toBe(403)
      const staffFileDelete = await request.delete(`/api/staff/portal/support-tickets/${ticket.id}/attachments?attachmentId=${staffFile.id}`, {
        headers: portalCookieHeaders(buyer.session),
      })
      expect(staffFileDelete.status()).toBe(403)

      expect((await listPortalAttachments(request, stranger, ticket.id)).status).toBe(404)
      expect((await uploadAsCustomer(request, stranger, ticket.id, 'intrusion.txt')).status()).toBe(404)

      const ownDelete = await request.delete(`/api/staff/portal/support-tickets/${ticket.id}/attachments?attachmentId=${own.id}`, {
        headers: portalCookieHeaders(buyer.session),
      })
      expect(ownDelete.status()).toBe(200)
      expect((await listPortalAttachments(request, buyer, ticket.id)).items.map((item) => item.fileName)).not.toContain('error-log.txt')
    } finally {
      await cleanup.run()
    }
  })

  test('files staged on the new-ticket form are uploaded with the ticket', async ({ browser, request }) => {
    test.setTimeout(180_000)
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const slug = await resolveOrgSlug(request, admin)
      const project = await createProject(request, admin, cleanup, 'files-ui')
      await pointFallbackAt(request, admin, cleanup, project.id)
      const category = await createCategory(request, admin, cleanup, 'files-ui')
      const buyer = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'files-ui' })

      const context = await browser.newContext()
      cleanup.add(() => context.close())
      const page = await context.newPage()
      await usePortalSessionInBrowser(page, buyer)
      await page.goto(`/${slug}/portal/support/new`, { waitUntil: 'domcontentloaded' })
      await dismissNotices(page)
      await page.locator('#support-category').click()
      await page.getByRole('option', { name: category.label, exact: true }).click()
      await page.locator('#support-subject').fill('Screenshot of the broken report')
      await page.locator('#support-description').fill('See the attached screenshot.')
      await page.getByTestId('support-new-file-input').setInputFiles({
        name: 'broken-report.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('report output'),
      })
      await expect(page.getByText('broken-report.txt').first()).toBeVisible()
      await page.getByRole('button', { name: 'File ticket' }).click()
      await page.waitForURL(new RegExp(`/${slug}/portal/support/[0-9a-f-]{36}$`), { timeout: 60_000 })
      const taskId = page.url().split('/').pop() as string
      cleanup.add(() => deleteTask(request, admin, taskId))
      cleanupTicketAttachments(request, admin, cleanup, taskId)
      await expect(page.getByTestId('support-attachments').getByText('broken-report.txt')).toBeVisible({ timeout: 60_000 })
      const listed = await listPortalAttachments(request, buyer, taskId)
      expect(listed.items.map((item) => item.fileName)).toContain('broken-report.txt')

      await page.getByTestId('support-detail-file-input').setInputFiles({
        name: 'follow-up.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('more details'),
      })
      await expect(page.getByTestId('support-attachments').getByText('follow-up.txt')).toBeVisible({ timeout: 60_000 })
    } finally {
      await cleanup.run()
    }
  })
})
