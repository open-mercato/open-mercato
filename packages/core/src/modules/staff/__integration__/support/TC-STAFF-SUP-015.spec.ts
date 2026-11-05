/**
 * TC-STAFF-SUP-015: Support Inbox — customer and category filters, live refresh.
 *
 * The Support Inbox (`/backend/staff/time-tracking/support`) narrows tickets to one
 * customer through the Customer filter, offers an `employee` assigner every category
 * of the organization in the Category filter (served by
 * `/api/staff/timesheets/support-tickets/options`), and an open inbox picks up a newly filed
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

  test('an employee assigner filters by any organization category, not only those on the page', async ({ browser, request }) => {
    test.setTimeout(180_000)
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const project = await createProject(request, admin, cleanup, 'inbox-category')
      const filed = await createCategory(request, admin, cleanup, 'inbox-cat-filed')
      const other = await createCategory(request, admin, cleanup, 'inbox-cat-other')
      const untouched = await createCategory(request, admin, cleanup, 'inbox-cat-empty')
      await createRoutingRule(request, admin, cleanup, { categoryValue: filed.value, timeProjectId: project.id })
      await createRoutingRule(request, admin, cleanup, { categoryValue: other.value, timeProjectId: project.id })
      const assigner = await createStaffPerson(request, admin, cleanup, 'inbox-category')
      await addProjectMember(request, admin, project.id, assigner.staffMemberId, { isAssigner: true })
      const customer = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'category' })

      const filedSubject = `Category filed ${Date.now()}`
      const otherSubject = `Category other ${Date.now()}`
      const filedTicket = await fileTicket(request, customer, { categoryValue: filed.value, subject: filedSubject })
      cleanup.add(() => deleteTask(request, admin, filedTicket.id))
      const otherTicket = await fileTicket(request, customer, { categoryValue: other.value, subject: otherSubject })
      cleanup.add(() => deleteTask(request, admin, otherTicket.id))

      const optionsResponse = await apiRequest(request, 'GET', '/api/staff/timesheets/support-tickets/options', {
        token: assigner.token,
      })
      expect(optionsResponse.status(), 'an employee must be able to read the inbox filter options').toBe(200)
      const options = (await optionsResponse.json()) as {
        categories?: Array<{ value: string }>
        assignees?: Array<{ id: string }>
      }
      const optionValues = options.categories?.map((category) => category.value) ?? []
      expect(optionValues).toEqual(expect.arrayContaining([filed.value, other.value, untouched.value]))
      expect(options.assignees?.map((assignee) => assignee.id) ?? []).toContain(assigner.staffMemberId)

      const context = await browser.newContext()
      cleanup.add(() => context.close())
      const staff = await context.newPage()
      await loginStaffInBrowser(staff, assigner)
      await staff.goto(INBOX_PATH, { waitUntil: 'domcontentloaded' })
      await dismissNotices(staff)
      await expect(staff.getByRole('row').filter({ hasText: filedSubject })).toBeVisible({ timeout: 60_000 })
      await expect(staff.getByRole('row').filter({ hasText: otherSubject })).toBeVisible()

      await staff.getByRole('button', { name: 'Filters' }).click()
      const categoryField = staff
        .locator('div.space-y-2')
        .filter({ has: staff.locator('div.text-sm.font-medium', { hasText: /^Category$/ }) })
        .last()
      await categoryField.getByRole('combobox').click()
      await expect(staff.getByRole('option', { name: untouched.label, exact: true }).first()).toBeVisible()
      await staff.getByRole('option', { name: filed.label, exact: true }).first().click()
      await staff.getByRole('button', { name: 'Apply' }).first().click()

      await expect(staff.getByRole('row').filter({ hasText: filedSubject })).toBeVisible({ timeout: 30_000 })
      await expect(staff.getByRole('row').filter({ hasText: otherSubject })).toHaveCount(0)
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
