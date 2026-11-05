/**
 * TC-STAFF-SUP-011: Support ticket routing variants.
 *
 * Covers the routing rules of `.ai/specs/2026-10-06-staff-helpdesk-support-tickets.md`:
 * every category into one project (with and without a customer), per-category
 * overrides, and the fallback behaviour of paused rules, unusable projects and deleted
 * categories. Each test creates its own categories and projects and restores the
 * organization fallback rule afterwards.
 */
import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  Cleanup,
  PORTAL_MANAGE,
  PORTAL_VIEW,
  adminToken,
  createCategory,
  createPortalCustomer,
  createProject,
  createRoutingRule,
  deleteCategory,
  deleteTask,
  ensureFallback,
  fileTicket,
  getPortalTicket,
  getStaffTask,
  pointFallbackAt,
  portalRequest,
  routingPreview,
} from './fixtures'

test.describe('TC-STAFF-SUP-011: Support ticket routing variants', () => {
  test('all categories land in one project that belongs to a customer', async ({ request }) => {
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const project = await createProject(request, admin, cleanup, 'single')
      await pointFallbackAt(request, admin, cleanup, project.id)
      const first = await createCategory(request, admin, cleanup, 'single-a')
      const second = await createCategory(request, admin, cleanup, 'single-b')
      const customer = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'single' })

      for (const category of [first, second]) {
        const ticket = await fileTicket(request, customer, { categoryValue: category.value })
        cleanup.add(() => deleteTask(request, admin, ticket.id))
        const task = await getStaffTask(request, admin, ticket.id)
        expect(task?.time_project_id).toBe(project.id)
        expect(task?._staffSupport?.ticket?.routedVia).toBe('fallback')
        expect(task?.customer_id).toBe(customer.companyId)
      }
    } finally {
      await cleanup.run()
    }
  })

  test('all categories land in the seeded project that has no customer', async ({ request }) => {
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const fallback = await ensureFallback(request, admin)
      await pointFallbackAt(request, admin, cleanup, fallback.timeProjectId)
      const category = await createCategory(request, admin, cleanup, 'nocustomer')
      const customer = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'nocustomer' })

      const ticket = await fileTicket(request, customer, { categoryValue: category.value })
      cleanup.add(() => deleteTask(request, admin, ticket.id))
      const task = await getStaffTask(request, admin, ticket.id)
      expect(task?.time_project_id).toBe(fallback.timeProjectId)
      const project = await apiRequest(request, 'GET', `/api/staff/timesheets/time-projects?ids=${fallback.timeProjectId}&pageSize=100`, { token: admin })
      const projectBody = (await project.json()) as { items?: Array<{ id?: string; customer_id?: string | null }> }
      const seeded = projectBody.items?.find((item) => item.id === fallback.timeProjectId)
      expect(seeded, 'the seeded fallback project should be listed').toBeTruthy()
      expect(seeded?.customer_id ?? null).toBeNull()
      const portal = await getPortalTicket(request, customer, ticket.id)
      expect(portal.status).toBe(200)
      expect(portal.body?.portalStatus).toBe('received')
    } finally {
      await cleanup.run()
    }
  })

  test('per-category rules send categories to their own projects; the rest falls back', async ({ request }) => {
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const fallbackProject = await createProject(request, admin, cleanup, 'fallback')
      const billingProject = await createProject(request, admin, cleanup, 'billing')
      const techProject = await createProject(request, admin, cleanup, 'tech')
      await pointFallbackAt(request, admin, cleanup, fallbackProject.id)
      const billing = await createCategory(request, admin, cleanup, 'billing')
      const tech = await createCategory(request, admin, cleanup, 'tech')
      const general = await createCategory(request, admin, cleanup, 'general')
      await createRoutingRule(request, admin, cleanup, { categoryValue: billing.value, timeProjectId: billingProject.id })
      await createRoutingRule(request, admin, cleanup, { categoryValue: tech.value, timeProjectId: techProject.id })
      const customer = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'routed' })

      const expectations: Array<[string, string, 'category' | 'fallback']> = [
        [billing.value, billingProject.id, 'category'],
        [tech.value, techProject.id, 'category'],
        [general.value, fallbackProject.id, 'fallback'],
      ]
      for (const [categoryValue, projectId, via] of expectations) {
        const ticket = await fileTicket(request, customer, { categoryValue })
        cleanup.add(() => deleteTask(request, admin, ticket.id))
        const task = await getStaffTask(request, admin, ticket.id)
        expect(task?.time_project_id, `category ${categoryValue}`).toBe(projectId)
        expect(task?._staffSupport?.ticket?.routedVia).toBe(via)
      }
      const preview = await routingPreview(request, admin)
      expect(preview.categories.find((entry) => entry.value === billing.value)?.route?.project.id).toBe(billingProject.id)
      expect(preview.categories.find((entry) => entry.value === general.value)?.route?.via).toBe('fallback')
    } finally {
      await cleanup.run()
    }
  })

  test('paused rules, completed projects and deleted categories fall back or close', async ({ request }) => {
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const fallbackProject = await createProject(request, admin, cleanup, 'fb2')
      const pausedProject = await createProject(request, admin, cleanup, 'paused')
      const closingProject = await createProject(request, admin, cleanup, 'closing')
      await pointFallbackAt(request, admin, cleanup, fallbackProject.id)
      const paused = await createCategory(request, admin, cleanup, 'paused')
      const closing = await createCategory(request, admin, cleanup, 'closing')
      const removed = await createCategory(request, admin, cleanup, 'removed')
      const pausedRule = await createRoutingRule(request, admin, cleanup, { categoryValue: paused.value, timeProjectId: pausedProject.id })
      await createRoutingRule(request, admin, cleanup, { categoryValue: closing.value, timeProjectId: closingProject.id })
      await createRoutingRule(request, admin, cleanup, { categoryValue: removed.value, timeProjectId: pausedProject.id })
      const customer = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'fallbacks' })

      const pause = await apiRequest(request, 'PUT', '/api/staff/timesheets/support-routing-rules', {
        token: admin,
        data: { id: pausedRule, isActive: false },
      })
      expect(pause.ok()).toBeTruthy()
      const complete = await apiRequest(request, 'PUT', '/api/staff/timesheets/time-projects', {
        token: admin,
        data: { id: closingProject.id, status: 'completed' },
      })
      expect(complete.ok()).toBeTruthy()

      for (const category of [paused, closing]) {
        const ticket = await fileTicket(request, customer, { categoryValue: category.value })
        cleanup.add(() => deleteTask(request, admin, ticket.id))
        const task = await getStaffTask(request, admin, ticket.id)
        expect(task?.time_project_id, `category ${category.value}`).toBe(fallbackProject.id)
        expect(task?._staffSupport?.ticket?.routedVia).toBe('fallback')
      }

      expect((await deleteCategory(request, admin, removed)).ok()).toBeTruthy()
      const options = await portalRequest(request, customer, 'GET', '/api/staff/portal/support-tickets/options')
      const optionsBody = (await options.json()) as { categories: Array<{ value: string }> }
      expect(optionsBody.categories.map((entry) => entry.value)).not.toContain(removed.value)
      const rejected = await portalRequest(request, customer, 'POST', '/api/staff/portal/support-tickets', {
        categoryValue: removed.value,
        subject: 'Deleted category',
        description: 'Should not be accepted',
      })
      expect(rejected.status()).toBe(422)
      const preview = await routingPreview(request, admin)
      const problems = new Map(preview.rules.map((rule) => [rule.categoryValue, rule.problem]))
      expect(problems.get(paused.value)).toBe('paused')
      expect(problems.get(closing.value)).toBe('project_unusable')
      expect(problems.get(removed.value)).toBe('category_missing')
    } finally {
      await cleanup.run()
    }
  })

  test('an unusable fallback project only closes categories without a working rule', async ({ request }) => {
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const doomed = await createProject(request, admin, cleanup, 'doomed')
      const kept = await createProject(request, admin, cleanup, 'kept')
      await pointFallbackAt(request, admin, cleanup, doomed.id)
      const routed = await createCategory(request, admin, cleanup, 'still-routed')
      const orphan = await createCategory(request, admin, cleanup, 'orphan')
      await createRoutingRule(request, admin, cleanup, { categoryValue: routed.value, timeProjectId: kept.id })
      const customer = await createPortalCustomer(request, admin, cleanup, { features: [PORTAL_VIEW, PORTAL_MANAGE], label: 'unusable' })

      const complete = await apiRequest(request, 'PUT', '/api/staff/timesheets/time-projects', {
        token: admin,
        data: { id: doomed.id, status: 'completed' },
      })
      expect(complete.ok()).toBeTruthy()

      const options = await portalRequest(request, customer, 'GET', '/api/staff/portal/support-tickets/options')
      const values = ((await options.json()) as { categories: Array<{ value: string }> }).categories.map((entry) => entry.value)
      expect(values).toContain(routed.value)
      expect(values).not.toContain(orphan.value)

      const ticket = await fileTicket(request, customer, { categoryValue: routed.value })
      cleanup.add(() => deleteTask(request, admin, ticket.id))
      expect((await getStaffTask(request, admin, ticket.id))?.time_project_id).toBe(kept.id)
      const rejected = await portalRequest(request, customer, 'POST', '/api/staff/portal/support-tickets', {
        categoryValue: orphan.value,
        subject: 'No route',
        description: 'Nothing can take this',
      })
      expect(rejected.status()).toBe(422)
      const preview = await routingPreview(request, admin)
      expect(preview.fallback?.project.usable).toBe(false)
    } finally {
      await cleanup.run()
    }
  })

  test('the fallback rule cannot be deleted, paused or duplicated', async ({ request }) => {
    const admin = await adminToken(request)
    const fallback = await ensureFallback(request, admin)
    const remove = await apiRequest(request, 'DELETE', `/api/staff/timesheets/support-routing-rules?id=${fallback.ruleId}`, { token: admin })
    expect(remove.status()).toBe(422)
    const pause = await apiRequest(request, 'PUT', '/api/staff/timesheets/support-routing-rules', {
      token: admin,
      data: { id: fallback.ruleId, isActive: false },
    })
    expect(pause.status()).toBe(422)
    const duplicate = await apiRequest(request, 'POST', '/api/staff/timesheets/support-routing-rules', {
      token: admin,
      data: { categoryValue: null, timeProjectId: fallback.timeProjectId },
    })
    expect(duplicate.status()).toBe(409)
    const again = await ensureFallback(request, admin)
    expect(again.ruleId).toBe(fallback.ruleId)
  })
})
