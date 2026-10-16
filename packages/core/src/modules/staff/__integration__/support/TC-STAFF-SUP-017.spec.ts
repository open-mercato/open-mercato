/**
 * TC-STAFF-SUP-017: "Share with customer" upload from the task drawer.
 *
 * Staff open a portal ticket in the TaskDrawer (Support Inbox, `?task=<id>`) and
 * upload a file in "Ticket files". With "Share with customer" checked the file is
 * tagged `customer-visible` and the portal ticket's attachments API lists it; with
 * the box unchecked the file stays internal and the portal never sees it.
 */
import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  Cleanup,
  PORTAL_MANAGE,
  PORTAL_VIEW,
  adminToken,
  createCategory,
  createPortalCustomer,
  createProject,
  createRoutingRule,
  deleteTask,
  dismissNotices,
  fileTicket,
} from './fixtures'
import {
  SUPPORT_INBOX_PATH,
  deleteTaskAttachments,
  listPortalTicketAttachmentNames,
  listTaskAttachments,
} from './backofficeFixtures'

test.describe('TC-STAFF-SUP-017: drawer upload shared with the customer', () => {
  test('only a file uploaded with "Share with customer" reaches the portal', async ({ page, request }) => {
    test.setTimeout(180_000)
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const project = await createProject(request, admin, cleanup, 'drawer-files')
      const category = await createCategory(request, admin, cleanup, 'drawer-files')
      await createRoutingRule(request, admin, cleanup, { categoryValue: category.value, timeProjectId: project.id })
      const customer = await createPortalCustomer(request, admin, cleanup, {
        features: [PORTAL_VIEW, PORTAL_MANAGE],
        label: 'drawer-files',
      })
      const ticket = await fileTicket(request, customer, { categoryValue: category.value })
      cleanup.add(() => deleteTask(request, admin, ticket.id))
      cleanup.add(() => deleteTaskAttachments(request, admin, ticket.id))

      const stamp = Date.now()
      const sharedName = `shared-${stamp}.txt`
      const internalName = `internal-${stamp}.txt`

      await login(page, 'admin')
      await page.goto(`${SUPPORT_INBOX_PATH}?task=${ticket.id}`, { waitUntil: 'domcontentloaded' })
      await dismissNotices(page)
      const section = page.getByTestId('support-attachments-section')
      await expect(section).toBeVisible({ timeout: 60_000 })

      const share = section.getByRole('checkbox', { name: 'Share with customer' })
      await share.check()
      await section.getByTestId('support-attachments-input').setInputFiles({
        name: sharedName,
        mimeType: 'text/plain',
        buffer: Buffer.from('Steps to fix the export.'),
      })
      await expect(section.getByText(sharedName)).toBeVisible({ timeout: 30_000 })

      await share.uncheck()
      await section.getByTestId('support-attachments-input').setInputFiles({
        name: internalName,
        mimeType: 'text/plain',
        buffer: Buffer.from('Internal analysis.'),
      })
      await expect(section.getByText(internalName)).toBeVisible({ timeout: 30_000 })

      const staffFiles = await listTaskAttachments(request, admin, ticket.id)
      const sharedFile = staffFiles.find((file) => file.fileName === sharedName)
      const internalFile = staffFiles.find((file) => file.fileName === internalName)
      expect(sharedFile?.tags ?? []).toContain('customer-visible')
      expect(internalFile?.tags ?? []).not.toContain('customer-visible')

      const portalNames = await listPortalTicketAttachmentNames(request, customer, ticket.id)
      expect(portalNames).toContain(sharedName)
      expect(portalNames).not.toContain(internalName)
    } finally {
      await cleanup.run()
    }
  })
})
