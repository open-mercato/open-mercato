/**
 * TC-STAFF-SUP-017: "Share with customer" upload from the task drawer.
 *
 * Staff open a portal ticket in the TaskDrawer (Support Inbox, `?task=<id>`) and
 * upload a file in "Ticket files". With "Share with customer" checked the file is
 * tagged `customer-visible` and the portal ticket's attachments API lists it; with
 * the box unchecked the file stays internal and the portal never sees it.
 *
 * While the drawer stays open, a customer upload (with or without a reply) reaches
 * "Ticket files" through `staff.support_ticket.activity_recorded`, without a reload.
 */
import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { portalCookieHeaders } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
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
  portalRequest,
  type PortalCustomer,
} from './fixtures'
import {
  SUPPORT_INBOX_PATH,
  deleteTaskAttachments,
  listPortalTicketAttachmentNames,
  listTaskAttachments,
} from './backofficeFixtures'

async function uploadAsCustomer(
  request: import('@playwright/test').APIRequestContext,
  customer: PortalCustomer,
  taskId: string,
  fileName: string,
) {
  const response = await request.fetch(`/api/staff/portal/support-tickets/${taskId}/attachments`, {
    method: 'POST',
    headers: portalCookieHeaders(customer.session),
    multipart: { file: { name: fileName, mimeType: 'text/plain', buffer: Buffer.from(`contents of ${fileName}`) } },
  })
  expect(response.status(), 'the customer upload should be stored').toBe(201)
}

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

  test('customer uploads reach an open drawer without a reload', async ({ page, request }) => {
    test.setTimeout(180_000)
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const project = await createProject(request, admin, cleanup, 'drawer-live-files')
      const category = await createCategory(request, admin, cleanup, 'drawer-live-files')
      await createRoutingRule(request, admin, cleanup, { categoryValue: category.value, timeProjectId: project.id })
      const customer = await createPortalCustomer(request, admin, cleanup, {
        features: [PORTAL_VIEW, PORTAL_MANAGE],
        label: 'drawer-live-files',
      })
      const ticket = await fileTicket(request, customer, { categoryValue: category.value })
      cleanup.add(() => deleteTask(request, admin, ticket.id))
      cleanup.add(() => deleteTaskAttachments(request, admin, ticket.id))

      const stamp = Date.now()
      const lonelyName = `customer-only-${stamp}.txt`
      const repliedName = `customer-replied-${stamp}.txt`
      const replyBody = `Scan attached ${stamp}`

      await login(page, 'admin')
      const streamOpened = page.waitForResponse((response) => response.url().includes('/api/events/stream'), {
        timeout: 60_000,
      })
      await page.goto(`${SUPPORT_INBOX_PATH}?task=${ticket.id}`, { waitUntil: 'domcontentloaded' })
      await streamOpened
      await dismissNotices(page)
      const section = page.getByTestId('support-attachments-section')
      await expect(section).toBeVisible({ timeout: 60_000 })
      await expect(section.getByText('No files on this ticket.')).toBeVisible({ timeout: 30_000 })
      let reloads = 0
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) reloads += 1
      })

      await uploadAsCustomer(request, customer, ticket.id, lonelyName)
      await expect(section.getByText(lonelyName)).toBeVisible({ timeout: 30_000 })

      await uploadAsCustomer(request, customer, ticket.id, repliedName)
      const reply = await portalRequest(request, customer, 'POST', `/api/staff/portal/support-tickets/${ticket.id}/messages`, {
        body: replyBody,
      })
      expect(reply.status()).toBe(201)
      await expect(page.getByText(replyBody)).toBeVisible({ timeout: 30_000 })
      await expect(section.getByText(repliedName)).toBeVisible({ timeout: 30_000 })
      expect(reloads, 'the drawer must update in place, not by navigating').toBe(0)
    } finally {
      await cleanup.run()
    }
  })
})
