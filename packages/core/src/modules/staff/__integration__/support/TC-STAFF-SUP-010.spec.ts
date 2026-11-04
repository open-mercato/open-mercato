/**
 * TC-STAFF-SUP-010: Full lifecycle of a customer support ticket, through the UI.
 *
 * A portal buyer files a ticket in the portal; it is routed to the project its
 * category points at; an assigner of that project is notified, claims it in the
 * backoffice drawer, adds an internal note and replies to the customer; the ticket is
 * resolved; the customer sees only the reply and the resolved status, replies again,
 * which reopens it; staff resolve it for good. The portal page stays open the whole
 * time: the reply and every status change reach it live (`portal_updated`), never by
 * a reload.
 */
import { expect, test } from '@playwright/test'
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
  findStatus,
  getPortalTicket,
  getStaffTask,
  loginStaffInBrowser,
  moveTask,
  pointFallbackAt,
  resolveOrgSlug,
  usePortalSessionInBrowser,
  waitForNotification,
} from './fixtures'

test.describe('TC-STAFF-SUP-010: Support ticket lifecycle through the portal and the backoffice', () => {
  test('customer files, assigner claims and answers, customer sees only the reply, reopen and resolve', async ({ browser, request }) => {
    test.setTimeout(240_000)
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const slug = await resolveOrgSlug(request, admin)
      const fallbackProject = await createProject(request, admin, cleanup, 'lifecycle-fb')
      const supportProject = await createProject(request, admin, cleanup, 'lifecycle')
      await pointFallbackAt(request, admin, cleanup, fallbackProject.id)
      const category = await createCategory(request, admin, cleanup, 'lifecycle')
      await createRoutingRule(request, admin, cleanup, { categoryValue: category.value, timeProjectId: supportProject.id })
      const assigner = await createStaffPerson(request, admin, cleanup, 'lifecycle-assigner')
      await addProjectMember(request, admin, supportProject.id, assigner.staffMemberId, { isAssigner: true })
      const customer = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'lifecycle' })

      const subject = `Invoice export fails ${Date.now()}`
      const portalContext = await browser.newContext()
      cleanup.add(() => portalContext.close())
      const portal = await portalContext.newPage()
      await usePortalSessionInBrowser(portal, customer)
      const portalStreamOpened = portal.waitForResponse(
        (response) => response.url().includes('/api/customer_accounts/portal/events/stream'),
        { timeout: 60_000 },
      )
      await portal.goto(`/${slug}/portal/support/new`, { waitUntil: 'domcontentloaded' })
      await portalStreamOpened
      await dismissNotices(portal)
      await portal.locator('#support-category').click()
      await portal.getByRole('option', { name: category.label, exact: true }).click()
      await portal.locator('#support-subject').fill(subject)
      await portal.locator('#support-description').fill('The CSV export stops at 50 rows since yesterday.')
      await portal.getByRole('button', { name: 'File ticket' }).click()
      await portal.waitForURL(new RegExp(`/${slug}/portal/support/[0-9a-f-]{36}$`), { timeout: 60_000 })
      const taskId = portal.url().split('/').pop() as string
      cleanup.add(() => deleteTask(request, admin, taskId))
      await expect(portal.getByText(subject).first()).toBeVisible()
      await expect(portal.getByText('Received').first()).toBeVisible()
      let portalNavigations = 0
      portal.on('framenavigated', (frame) => {
        if (frame === portal.mainFrame()) portalNavigations += 1
      })

      const routed = await getStaffTask(request, admin, taskId)
      expect(routed?.time_project_id).toBe(supportProject.id)
      expect(routed?._staffSupport?.ticket?.routedVia).toBe('category')
      expect(routed?.assignee_staff_member_id).toBeNull()
      expect(await waitForNotification(request, assigner.token, 'staff.support_ticket.created', taskId)).not.toBeNull()

      const staffContext = await browser.newContext()
      cleanup.add(() => staffContext.close())
      const staff = await staffContext.newPage()
      await loginStaffInBrowser(staff, assigner)
      await staff.goto(`/backend/staff/time-tracking/support?task=${taskId}`, { waitUntil: 'domcontentloaded' })
      await dismissNotices(staff)
      const drawer = staff.getByRole('dialog')
      await expect(drawer.getByText('Customer request', { exact: false }).first()).toBeVisible({ timeout: 60_000 })
      await drawer.getByTestId('task-drawer-claim').click()
      await expect(drawer.getByTestId('task-drawer-release')).toBeVisible({ timeout: 30_000 })

      await drawer.getByTestId('task-drawer-comment-input').fill('Internal: reproduced with a 51-row file.')
      await drawer.getByTestId('task-drawer-comment-internal-note').click()
      await expect(drawer.getByText('Internal: reproduced with a 51-row file.')).toBeVisible({ timeout: 30_000 })
      await drawer.getByTestId('task-drawer-comment-input').fill('Thanks! A fix is on the way.')
      await drawer.getByTestId('task-drawer-comment-reply-customer').click()
      await expect(drawer.getByText('Thanks! A fix is on the way.')).toBeVisible({ timeout: 30_000 })
      expect((await getStaffTask(request, admin, taskId))?.assignee_staff_member_id).toBe(assigner.staffMemberId)
      await expect(portal.getByText('Thanks! A fix is on the way.')).toBeVisible({ timeout: 30_000 })
      await expect(portal.getByText('Internal: reproduced with a 51-row file.')).toHaveCount(0)

      const doneStatus = await findStatus(request, assigner.token, supportProject.id, 'done')
      expect((await moveTask(request, assigner.token, taskId, doneStatus)).ok()).toBeTruthy()

      await expect(portal.getByText('Resolved').first()).toBeVisible({ timeout: 30_000 })
      await expect(portal.getByText('Internal: reproduced with a 51-row file.')).toHaveCount(0)

      await portal.getByLabel('Your reply').fill('Still failing for 120 rows.')
      await portal.getByRole('button', { name: 'Send reply' }).click()
      await expect(portal.getByText('Still failing for 120 rows.')).toBeVisible({ timeout: 30_000 })
      await expect.poll(async () => (await getPortalTicket(request, customer, taskId)).body?.portalStatus, { timeout: 30_000 }).toBe('received')
      await expect(portal.getByText('Resolved')).toHaveCount(0, { timeout: 30_000 })
      expect(await waitForNotification(request, assigner.token, 'staff.support_ticket.customer_replied', taskId)).not.toBeNull()

      expect((await moveTask(request, assigner.token, taskId, doneStatus)).ok()).toBeTruthy()
      await expect.poll(async () => (await getPortalTicket(request, customer, taskId)).body?.portalStatus, { timeout: 30_000 }).toBe('resolved')
      await expect(portal.getByText('Resolved').first()).toBeVisible({ timeout: 30_000 })
      expect(portalNavigations, 'the portal ticket page must update in place, not by navigating').toBe(0)
      const finalDetail = await getPortalTicket(request, customer, taskId)
      expect(finalDetail.body?.messages.map((message) => message.body)).not.toContain('Internal: reproduced with a 51-row file.')
    } finally {
      await cleanup.run()
    }
  })
})
