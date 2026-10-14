/**
 * TC-STAFF-SUP-015: Support Inbox — customer filter and live refresh.
 *
 * The Support Inbox (`/backend/staff/time-tracking/support`) narrows tickets to one
 * customer through the Customer filter, and an open inbox picks up a newly filed
 * ticket (`staff.support_ticket.activity_recorded`) and an assignee change
 * (`staff.timesheets.time_task.assignee_changed`) without a reload.
 */
import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  Cleanup,
  PORTAL_MANAGE,
  PORTAL_VIEW,
  addProjectMember,
  adminToken,
  createCategory,
  createPortalCustomer,
  createProject,
  createRoutingRule,
  createStaffPerson,
  deleteTask,
  dismissNotices,
  fileTicket,
  loginStaffInBrowser,
} from './fixtures'

const INBOX_PATH = '/backend/staff/time-tracking/support'

test.describe('TC-STAFF-SUP-015: Support Inbox customer filter and live refresh', () => {
  test('the customer filter shows only that customer’s tickets', async ({ browser, request }) => {
    test.setTimeout(180_000)
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const project = await createProject(request, admin, cleanup, 'inbox-filter')
      const category = await createCategory(request, admin, cleanup, 'inbox-filter')
      await createRoutingRule(request, admin, cleanup, { categoryValue: category.value, timeProjectId: project.id })
      const assigner = await createStaffPerson(request, admin, cleanup, 'inbox-filter')
      await addProjectMember(request, admin, project.id, assigner.staffMemberId, { isAssigner: true })
      const first = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'filter-a' })
      const second = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'filter-b' })

      const firstSubject = `Filter A ${Date.now()}`
      const secondSubject = `Filter B ${Date.now()}`
      const firstTicket = await fileTicket(request, first, { categoryValue: category.value, subject: firstSubject })
      cleanup.add(() => deleteTask(request, admin, firstTicket.id))
      const secondTicket = await fileTicket(request, second, { categoryValue: category.value, subject: secondSubject })
      cleanup.add(() => deleteTask(request, admin, secondTicket.id))

      const narrowed = await apiRequest(
        request,
        'GET',
        `/api/staff/timesheets/tasks?source=portal&customerId=${first.companyId}&pageSize=100`,
        { token: assigner.token },
      )
      expect(narrowed.ok()).toBeTruthy()
      const narrowedIds = ((await narrowed.json()) as { items?: Array<{ id?: string }> }).items?.map((item) => item.id) ?? []
      expect(narrowedIds).toContain(firstTicket.id)
      expect(narrowedIds).not.toContain(secondTicket.id)

      const context = await browser.newContext()
      cleanup.add(() => context.close())
      const staff = await context.newPage()
      await loginStaffInBrowser(staff, assigner)
      await staff.goto(INBOX_PATH, { waitUntil: 'domcontentloaded' })
      await dismissNotices(staff)
      await expect(staff.getByRole('row').filter({ hasText: firstSubject })).toBeVisible({ timeout: 60_000 })
      await expect(staff.getByRole('row').filter({ hasText: secondSubject })).toBeVisible()

      await staff.getByRole('button', { name: 'Filters' }).click()
      await staff.getByPlaceholder('Search customers').fill(first.companyName as string)
      await staff.getByRole('option', { name: new RegExp(first.companyName as string) }).first().click()
      await staff.getByRole('button', { name: 'Apply' }).first().click()

      await expect(staff.getByRole('row').filter({ hasText: firstSubject })).toBeVisible({ timeout: 30_000 })
      await expect(staff.getByRole('row').filter({ hasText: secondSubject })).toHaveCount(0)
    } finally {
      await cleanup.run()
    }
  })

  test('an open inbox shows a new ticket and an assignee change without a reload', async ({ browser, request }) => {
    test.setTimeout(180_000)
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const project = await createProject(request, admin, cleanup, 'inbox-live')
      const category = await createCategory(request, admin, cleanup, 'inbox-live')
      await createRoutingRule(request, admin, cleanup, { categoryValue: category.value, timeProjectId: project.id })
      const assigner = await createStaffPerson(request, admin, cleanup, 'inbox-live')
      await addProjectMember(request, admin, project.id, assigner.staffMemberId, { isAssigner: true })
      const customer = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'live' })

      const context = await browser.newContext()
      cleanup.add(() => context.close())
      const staff = await context.newPage()
      await loginStaffInBrowser(staff, assigner)
      const listLoaded = staff.waitForResponse(
        (response) => response.url().includes('/api/staff/timesheets/tasks?') && response.ok(),
        { timeout: 60_000 },
      )
      const streamOpened = staff.waitForResponse((response) => response.url().includes('/api/events/stream'), {
        timeout: 60_000,
      })
      await staff.goto(INBOX_PATH, { waitUntil: 'domcontentloaded' })
      await Promise.all([listLoaded, streamOpened])
      await dismissNotices(staff)
      let reloads = 0
      staff.on('framenavigated', (frame) => {
        if (frame === staff.mainFrame()) reloads += 1
      })

      const subject = `Live refresh ${Date.now()}`
      const ticket = await fileTicket(request, customer, { categoryValue: category.value, subject })
      cleanup.add(() => deleteTask(request, admin, ticket.id))
      const row = staff.getByRole('row').filter({ hasText: subject })
      await expect(row).toBeVisible({ timeout: 30_000 })
      await expect(row).not.toContainText(assigner.displayName)

      const claim = await apiRequest(request, 'POST', `/api/staff/timesheets/tasks/${ticket.id}/claim`, { token: assigner.token })
      expect(claim.status()).toBe(200)
      await expect(row).toContainText(assigner.displayName, { timeout: 30_000 })
      expect(reloads, 'the inbox must update in place, not by navigating').toBe(0)
    } finally {
      await cleanup.run()
    }
  })
})
