/**
 * TC-STAFF-SUP-012: Project roles around support tickets.
 *
 * Default assignee, assigners (claim / release), plain members, non-members, the
 * project owner as a notification fallback, portal buyers vs viewers, and isolation
 * between two customer companies whose tickets land in the same project.
 */
import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  Cleanup,
  PORTAL_MANAGE,
  PORTAL_VIEW,
  addProjectMember,
  adminToken,
  createAccountlessMember,
  createCategory,
  createPortalCustomer,
  createProject,
  createStaffPerson,
  deleteTask,
  fileTicket,
  getPortalTicket,
  getStaffTask,
  pointFallbackAt,
  portalRequest,
  setProjectFields,
  waitForNotification,
} from './fixtures'

test.describe('TC-STAFF-SUP-012: Project roles around support tickets', () => {
  test('the default assignee receives portal tickets once, through the new-ticket notification', async ({ request }) => {
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const project = await createProject(request, admin, cleanup, 'default')
      const agent = await createStaffPerson(request, admin, cleanup, 'default-agent')
      await addProjectMember(request, admin, project.id, agent.staffMemberId)
      const set = await setProjectFields(request, admin, project.id, { defaultAssigneeStaffMemberId: agent.staffMemberId })
      expect(set.ok(), `set default assignee: ${set.status()}`).toBeTruthy()
      await pointFallbackAt(request, admin, cleanup, project.id)
      const category = await createCategory(request, admin, cleanup, 'default')
      const customer = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'default' })

      const ticket = await fileTicket(request, customer, { categoryValue: category.value })
      cleanup.add(() => deleteTask(request, admin, ticket.id))
      expect((await getStaffTask(request, admin, ticket.id))?.assignee_staff_member_id).toBe(agent.staffMemberId)
      expect(await waitForNotification(request, agent.token, 'staff.support_ticket.created', ticket.id)).not.toBeNull()
      expect(
        await waitForNotification(request, agent.token, 'staff.timesheets.time_task.assigned', ticket.id, { expectNone: true }),
      ).toBeNull()
    } finally {
      await cleanup.run()
    }
  })

  test('assigners are notified and can claim and release; plain members and outsiders cannot', async ({ request }) => {
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const project = await createProject(request, admin, cleanup, 'claims')
      const assigner = await createStaffPerson(request, admin, cleanup, 'assigner')
      const member = await createStaffPerson(request, admin, cleanup, 'member')
      const outsider = await createStaffPerson(request, admin, cleanup, 'outsider')
      await addProjectMember(request, admin, project.id, assigner.staffMemberId, { isAssigner: true })
      await addProjectMember(request, admin, project.id, member.staffMemberId)
      await pointFallbackAt(request, admin, cleanup, project.id)
      const category = await createCategory(request, admin, cleanup, 'claims')
      const customer = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'claims' })

      const ticket = await fileTicket(request, customer, { categoryValue: category.value })
      cleanup.add(() => deleteTask(request, admin, ticket.id))
      expect((await getStaffTask(request, admin, ticket.id))?.assignee_staff_member_id).toBeNull()
      expect(await waitForNotification(request, assigner.token, 'staff.support_ticket.created', ticket.id)).not.toBeNull()

      expect((await getStaffTask(request, member.token, ticket.id))?.id).toBe(ticket.id)
      const memberClaim = await apiRequest(request, 'POST', `/api/staff/timesheets/tasks/${ticket.id}/claim`, { token: member.token })
      expect(memberClaim.status()).toBe(403)

      expect(await getStaffTask(request, outsider.token, ticket.id)).toBeNull()
      const outsiderClaim = await apiRequest(request, 'POST', `/api/staff/timesheets/tasks/${ticket.id}/claim`, { token: outsider.token })
      expect(outsiderClaim.status()).toBe(404)

      const claim = await apiRequest(request, 'POST', `/api/staff/timesheets/tasks/${ticket.id}/claim`, { token: assigner.token })
      expect(claim.status()).toBe(200)
      expect(((await readJsonSafe<{ assigneeStaffMemberId: string }>(claim)) ?? { assigneeStaffMemberId: '' }).assigneeStaffMemberId).toBe(
        assigner.staffMemberId,
      )
      const claimAgain = await apiRequest(request, 'POST', `/api/staff/timesheets/tasks/${ticket.id}/claim`, { token: assigner.token })
      expect(claimAgain.status()).toBe(409)

      const memberRelease = await apiRequest(request, 'POST', `/api/staff/timesheets/tasks/${ticket.id}/release`, { token: member.token })
      expect(memberRelease.status()).toBe(403)
      const release = await apiRequest(request, 'POST', `/api/staff/timesheets/tasks/${ticket.id}/release`, { token: assigner.token })
      expect(release.status()).toBe(200)
      expect((await getStaffTask(request, admin, ticket.id))?.assignee_staff_member_id).toBeNull()
      expect(await waitForNotification(request, admin, 'staff.timesheets.time_task.released', ticket.id)).not.toBeNull()
    } finally {
      await cleanup.run()
    }
  })

  test('two assigners racing for one ticket: exactly one wins', async ({ request }) => {
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const project = await createProject(request, admin, cleanup, 'race')
      const first = await createStaffPerson(request, admin, cleanup, 'racer-a')
      const second = await createStaffPerson(request, admin, cleanup, 'racer-b')
      await addProjectMember(request, admin, project.id, first.staffMemberId, { isAssigner: true })
      await addProjectMember(request, admin, project.id, second.staffMemberId, { isAssigner: true })
      await pointFallbackAt(request, admin, cleanup, project.id)
      const category = await createCategory(request, admin, cleanup, 'race')
      const customer = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'race' })
      const ticket = await fileTicket(request, customer, { categoryValue: category.value })
      cleanup.add(() => deleteTask(request, admin, ticket.id))

      const [a, b] = await Promise.all([
        apiRequest(request, 'POST', `/api/staff/timesheets/tasks/${ticket.id}/claim`, { token: first.token }),
        apiRequest(request, 'POST', `/api/staff/timesheets/tasks/${ticket.id}/claim`, { token: second.token }),
      ])
      expect([a.status(), b.status()].sort()).toEqual([200, 409])
    } finally {
      await cleanup.run()
    }
  })

  test('the project owner is notified when the project has no assigners', async ({ request }) => {
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const project = await createProject(request, admin, cleanup, 'owner')
      const owner = await createStaffPerson(request, admin, cleanup, 'owner')
      const set = await setProjectFields(request, admin, project.id, { ownerUserId: owner.userId })
      expect(set.ok()).toBeTruthy()
      await pointFallbackAt(request, admin, cleanup, project.id)
      const category = await createCategory(request, admin, cleanup, 'owner')
      const customer = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'owner' })
      const ticket = await fileTicket(request, customer, { categoryValue: category.value })
      cleanup.add(() => deleteTask(request, admin, ticket.id))
      expect(await waitForNotification(request, owner.token, 'staff.support_ticket.created', ticket.id)).not.toBeNull()
      expect((await getStaffTask(request, admin, ticket.id))?._staffSupport?.ticket?.unnotifiedAt ?? null).toBeNull()
    } finally {
      await cleanup.run()
    }
  })

  test('assigner and default-assignee settings are validated', async ({ request }) => {
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const project = await createProject(request, admin, cleanup, 'validation')
      const noAccount = await createAccountlessMember(request, admin, cleanup)
      const assign = await apiRequest(request, 'POST', `/api/staff/timesheets/time-projects/${project.id}/employees`, {
        token: admin,
        data: {
          staffMemberId: noAccount,
          status: 'active',
          assignedStartDate: new Date().toISOString().slice(0, 10),
          isAssigner: true,
        },
      })
      expect(assign.status()).toBe(422)
      const stranger = await createStaffPerson(request, admin, cleanup, 'stranger')
      const setDefault = await setProjectFields(request, admin, project.id, { defaultAssigneeStaffMemberId: stranger.staffMemberId })
      expect(setDefault.status()).toBe(422)
    } finally {
      await cleanup.run()
    }
  })

  test('staff task creation still assigns the creator on a project with a default assignee', async ({ request }) => {
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const project = await createProject(request, admin, cleanup, 'd2')
      const agent = await createStaffPerson(request, admin, cleanup, 'd2-default')
      const creator = await createStaffPerson(request, admin, cleanup, 'd2-creator')
      await addProjectMember(request, admin, project.id, agent.staffMemberId)
      await addProjectMember(request, admin, project.id, creator.staffMemberId)
      expect((await setProjectFields(request, admin, project.id, { defaultAssigneeStaffMemberId: agent.staffMemberId })).ok()).toBeTruthy()

      for (const assignee of [undefined, null]) {
        const response = await apiRequest(request, 'POST', '/api/staff/timesheets/tasks', {
          token: creator.token,
          data: { timeProjectId: project.id, title: `D2 ${String(assignee)}`, ...(assignee === undefined ? {} : { assigneeStaffMemberId: assignee }) },
        })
        expect(response.status()).toBe(201)
        const { id } = (await response.json()) as { id: string }
        cleanup.add(() => deleteTask(request, admin, id))
        expect((await getStaffTask(request, admin, id))?.assignee_staff_member_id).toBe(creator.staffMemberId)
      }
    } finally {
      await cleanup.run()
    }
  })

  test('portal viewers can read but not file; another company never sees the ticket', async ({ request }) => {
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const project = await createProject(request, admin, cleanup, 'portal-roles')
      await pointFallbackAt(request, admin, cleanup, project.id)
      const category = await createCategory(request, admin, cleanup, 'portal-roles')
      const buyer = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'buyer' })
      const viewer = await createPortalCustomer(request, admin, cleanup, {
        features: [PORTAL_VIEW],
        companyId: buyer.companyId,
        label: 'viewer',
      })
      const outsider = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'other-co' })

      const ticket = await fileTicket(request, buyer, { categoryValue: category.value, subject: 'Shared project ticket' })
      cleanup.add(() => deleteTask(request, admin, ticket.id))

      const viewerOptions = await portalRequest(request, viewer, 'GET', '/api/staff/portal/support-tickets/options')
      expect(((await viewerOptions.json()) as { canCreate: boolean }).canCreate).toBe(false)
      const viewerCreate = await portalRequest(request, viewer, 'POST', '/api/staff/portal/support-tickets', {
        categoryValue: category.value,
        subject: 'Viewer attempt',
        description: 'Should be refused',
      })
      expect(viewerCreate.status()).toBe(403)
      expect((await getPortalTicket(request, viewer, ticket.id)).status).toBe(200)

      const otherTicket = await fileTicket(request, outsider, { categoryValue: category.value, subject: 'Other company ticket' })
      cleanup.add(() => deleteTask(request, admin, otherTicket.id))
      expect((await getStaffTask(request, admin, otherTicket.id))?.time_project_id).toBe(project.id)
      expect((await getPortalTicket(request, outsider, ticket.id)).status).toBe(404)
      const outsiderList = await portalRequest(request, outsider, 'GET', '/api/staff/portal/support-tickets')
      const ids = ((await outsiderList.json()) as { items: Array<{ id: string }> }).items.map((item) => item.id)
      expect(ids).toContain(otherTicket.id)
      expect(ids).not.toContain(ticket.id)
      const outsiderReply = await portalRequest(request, outsider, 'POST', `/api/staff/portal/support-tickets/${ticket.id}/messages`, {
        body: 'Not mine',
      })
      expect(outsiderReply.status()).toBe(404)

      const anonymous = await request.get('/api/staff/portal/support-tickets', { headers: { Cookie: '' } })
      expect(anonymous.status()).toBe(401)
    } finally {
      await cleanup.run()
    }
  })
})
