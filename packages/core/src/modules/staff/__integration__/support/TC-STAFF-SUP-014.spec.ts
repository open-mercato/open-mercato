/**
 * TC-STAFF-SUP-014: Conversation visibility and portal response hygiene.
 *
 * Comments default to internal; only portal tickets can carry customer-visible
 * replies; customer messages are immutable for staff, managers included; a retracted
 * reply disappears from the portal; the portal never sees staff-edited task text,
 * the project or the internal task reference; the portal list orders tickets by
 * the newest customer-visible activity. Integration runs disable rate limiting
 * globally (OM_INTEGRATION_TEST), so the per-customer-user limits on ticket creation,
 * replies and uploads are covered by `lib/support/__tests__/portalRoute.test.ts`.
 */
import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  Cleanup,
  PORTAL_MANAGE,
  PORTAL_VIEW,
  adminToken,
  createCategory,
  createPortalCustomer,
  createProject,
  deleteTask,
  fileTicket,
  getPortalTicket,
  pointFallbackAt,
  portalRequest,
  staffComment,
} from './fixtures'

type CommentRow = { id: string; body: string; visibility: string; authorKind: string; updatedAt?: string | null }

async function listComments(request: import('@playwright/test').APIRequestContext, token: string, taskId: string): Promise<CommentRow[]> {
  const response = await apiRequest(request, 'GET', `/api/staff/timesheets/tasks/${taskId}/comments?pageSize=100`, { token })
  return (await readJsonSafe<{ items?: CommentRow[] }>(response))?.items ?? []
}

test.describe('TC-STAFF-SUP-014: Conversation visibility and portal hygiene', () => {
  test('visibility defaults, portal-only replies, immutable customer messages and retraction', async ({ request }) => {
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const project = await createProject(request, admin, cleanup, 'visibility')
      await pointFallbackAt(request, admin, cleanup, project.id)
      const category = await createCategory(request, admin, cleanup, 'visibility')
      const customer = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'visibility' })

      const internalTask = await apiRequest(request, 'POST', '/api/staff/timesheets/tasks', {
        token: admin,
        data: { timeProjectId: project.id, title: 'Internal only task' },
      })
      expect(internalTask.status()).toBe(201)
      const internalTaskId = ((await internalTask.json()) as { id: string }).id
      cleanup.add(() => deleteTask(request, admin, internalTaskId))
      const defaulted = await apiRequest(request, 'POST', `/api/staff/timesheets/tasks/${internalTaskId}/comments`, {
        token: admin,
        data: { body: 'No visibility given' },
      })
      expect(defaulted.status()).toBe(201)
      expect((await listComments(request, admin, internalTaskId))[0]?.visibility).toBe('internal')
      expect((await staffComment(request, admin, internalTaskId, 'Should be refused', 'customer')).status()).toBe(422)

      const ticket = await fileTicket(request, customer, {
        categoryValue: category.value,
        subject: 'Original subject from the customer',
        description: 'Original description from the customer',
      })
      cleanup.add(() => deleteTask(request, admin, ticket.id))
      const customerMessage = await portalRequest(request, customer, 'POST', `/api/staff/portal/support-tickets/${ticket.id}/messages`, {
        body: 'Customer follow-up',
      })
      expect(customerMessage.status()).toBe(201)
      const customerComment = (await listComments(request, admin, ticket.id)).find((row) => row.body === 'Customer follow-up')
      expect(customerComment?.authorKind).toBe('customer')
      const editCustomer = await apiRequest(request, 'PUT', `/api/staff/timesheets/tasks/${ticket.id}/comments`, {
        token: admin,
        data: { id: customerComment!.id, body: 'Rewritten by a manager' },
      })
      expect(editCustomer.status()).toBe(403)
      const deleteCustomer = await apiRequest(request, 'DELETE', `/api/staff/timesheets/tasks/${ticket.id}/comments?id=${customerComment!.id}`, {
        token: admin,
      })
      expect(deleteCustomer.status()).toBe(403)

      expect((await staffComment(request, admin, ticket.id, 'A reply we will retract', 'customer')).status()).toBe(201)
      expect((await getPortalTicket(request, customer, ticket.id)).body?.messages.map((message) => message.body)).toContain(
        'A reply we will retract',
      )
      const reply = (await listComments(request, admin, ticket.id)).find((row) => row.body === 'A reply we will retract')!
      const retract = await apiRequest(request, 'PUT', `/api/staff/timesheets/tasks/${ticket.id}/comments`, {
        token: admin,
        data: { id: reply.id, visibility: 'internal' },
      })
      expect(retract.ok(), `retract: ${retract.status()}`).toBeTruthy()
      expect((await getPortalTicket(request, customer, ticket.id)).body?.messages.map((message) => message.body)).not.toContain(
        'A reply we will retract',
      )

      const editTask = await apiRequest(request, 'PUT', '/api/staff/timesheets/tasks', {
        token: admin,
        data: { id: ticket.id, title: 'Triage: export bug', description: 'Internal triage notes, do not share' },
      })
      expect(editTask.ok()).toBeTruthy()
      const portalDetail = await portalRequest(request, customer, 'GET', `/api/staff/portal/support-tickets/${ticket.id}`)
      const raw = await portalDetail.text()
      const detail = JSON.parse(raw) as { subject: string; description: string }
      expect(detail.subject).toBe('Original subject from the customer')
      expect(detail.description).toBe('Original description from the customer')
      expect(raw).not.toContain('Internal triage notes')
      expect(raw).not.toContain(project.id)
      expect(raw).not.toContain(project.code)
      for (const forbidden of ['timeProjectId', 'projectName', 'reference"', 'assignee', 'hourlyRate', 'amount']) {
        expect(raw, `portal detail must not expose ${forbidden}`).not.toContain(forbidden)
      }
    } finally {
      await cleanup.run()
    }
  })

  test('the portal list puts the newest customer-visible activity first', async ({ request }) => {
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const project = await createProject(request, admin, cleanup, 'ordering')
      await pointFallbackAt(request, admin, cleanup, project.id)
      const category = await createCategory(request, admin, cleanup, 'ordering')
      const customer = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'ordering' })

      const older = await fileTicket(request, customer, { categoryValue: category.value, subject: `Ordering older ${Date.now()}` })
      cleanup.add(() => deleteTask(request, admin, older.id))
      const newer = await fileTicket(request, customer, { categoryValue: category.value, subject: `Ordering newer ${Date.now()}` })
      cleanup.add(() => deleteTask(request, admin, newer.id))

      const listIds = async (): Promise<string[]> => {
        const response = await portalRequest(request, customer, 'GET', '/api/staff/portal/support-tickets?pageSize=50')
        expect(response.status()).toBe(200)
        return ((await readJsonSafe<{ items?: Array<{ id: string }> }>(response))?.items ?? []).map((item) => item.id)
      }
      expect(await listIds()).toEqual([newer.id, older.id])

      expect((await staffComment(request, admin, older.id, 'We are on it.', 'customer')).status()).toBe(201)
      expect(await listIds()).toEqual([older.id, newer.id])

      expect((await staffComment(request, admin, newer.id, 'Internal triage note.', 'internal')).status()).toBe(201)
      expect(await listIds()).toEqual([older.id, newer.id])
    } finally {
      await cleanup.run()
    }
  })
})
