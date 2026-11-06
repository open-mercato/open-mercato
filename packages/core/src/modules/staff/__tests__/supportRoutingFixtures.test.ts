import type { APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { Cleanup, createCustomerFreeProject, listProjectStatuses, pointFallbackAt } from '../__integration__/support/fixtures'

jest.mock('@playwright/test', () => ({ expect: (value: unknown) => expect(value) }))
jest.mock('@open-mercato/core/helpers/integration/api', () => ({ apiRequest: jest.fn() }))
jest.mock('@open-mercato/core/helpers/integration/crmFixtures', () => ({
  createCompanyFixture: jest.fn(),
  deleteEntityIfExists: jest.fn(),
}))

const mockApiRequest = jest.mocked(apiRequest)
const request = {} as APIRequestContext
const admin = 'admin-token'
const projectPath = '/api/staff/timesheets/time-projects'
const ownedProjectId = 'owned-project'

type Project = { id: string; name: string; project_type: string; customer_id: string | null }

function setupRouting(existingProjects: Project[], options: { failCustomerClear?: boolean } = {}) {
  let timeProjectId = 'original-fallback-project'
  const projects = new Map(existingProjects.map((project) => [project.id, { ...project }]))
  const events: string[] = []
  mockApiRequest.mockImplementation(async (_request, method, pathname, requestOptions) => {
    let body: unknown
    let status = 200
    if (method === 'POST' && pathname.endsWith('/fallback-project')) {
      body = { ruleId: 'fallback-rule', timeProjectId, created: false }
    } else if (method === 'POST' && pathname === projectPath) {
      const data = requestOptions?.data as { name: string; projectType: string; customerId: string }
      projects.set(ownedProjectId, {
        id: ownedProjectId, name: data.name, project_type: data.projectType, customer_id: data.customerId,
      })
      body = { id: ownedProjectId }
    } else if (method === 'PUT' && pathname === projectPath) {
      const data = requestOptions?.data as { id: string; customerId: null; customerSnapshot: null }
      expect(data).toEqual({ id: ownedProjectId, customerId: null, customerSnapshot: null })
      if (options.failCustomerClear) {
        status = 500
      } else {
        projects.get(data.id)!.customer_id = null
      }
      body = { ok: status === 200 }
    } else if (method === 'GET' && pathname.startsWith('/api/staff/timesheets/task-statuses?')) {
      const projectId = new URL(pathname, 'http://test.local').searchParams.get('timeProjectId')
      expect(projectId).toBe(ownedProjectId)
      expect(projects.has(ownedProjectId)).toBe(true)
      body = { items: [
        { id: 'owned-default', slug: 'todo', is_default: true, is_done: false },
        { id: 'owned-done', slug: 'done', is_default: false, is_done: true },
      ] }
    } else if (method === 'GET' && pathname.startsWith(`${projectPath}?`)) {
      body = { items: [...projects.values()] }
    } else if (method === 'PUT' && pathname === '/api/staff/timesheets/support-routing-rules') {
      timeProjectId = (requestOptions?.data as { timeProjectId: string }).timeProjectId
      events.push(`fallback:${timeProjectId}`)
      body = { ok: true }
    } else if (method === 'DELETE' && pathname === `${projectPath}?id=${ownedProjectId}`) {
      events.push(`delete:${ownedProjectId}`)
      expect(timeProjectId).toBe('original-fallback-project')
      projects.delete(ownedProjectId)
      body = { ok: true }
    } else {
      throw new Error(`[internal] unexpected fixture request: ${method} ${pathname}`)
    }
    return {
      ok: () => status === 200, status: () => status,
      text: async () => JSON.stringify(body), json: async () => body,
    } as Awaited<ReturnType<typeof apiRequest>>
  })
  return { projects, events, currentProjectId: () => timeProjectId }
}

const seededProject: Project = {
  id: 'original-fallback-project',
  name: 'Customer support',
  project_type: 'internal',
  customer_id: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockApiRequest.mockReset()
  jest.mocked(createCompanyFixture).mockResolvedValue('owned-customer')
  jest.mocked(deleteEntityIfExists).mockResolvedValue(undefined)
})

it.each([
  ['renamed default', [{ ...seededProject, name: 'Renamed support desk' }]],
  ['missing default', []],
  ['customer-linked default', [{ ...seededProject, customer_id: 'unrelated-customer' }]],
  ['duplicate names', [seededProject, { ...seededProject, id: 'duplicate-project' }]],
] satisfies Array<[string, Project[]]>)('owns its project despite %s and restores the original fallback before cleanup', async (_label, existingProjects) => {
  const routing = setupRouting(existingProjects)
  const cleanup = new Cleanup()
  try {
    const project = await createCustomerFreeProject(request, admin, cleanup)
    expect(project.id).toBe(ownedProjectId)
    expect(routing.projects.get(project.id)).toEqual({
      id: ownedProjectId, name: project.name, project_type: 'internal', customer_id: null,
    })
    expect(routing.currentProjectId()).toBe('original-fallback-project')
    const statuses = await listProjectStatuses(request, admin, project.id)
    expect(statuses).toEqual([
      { id: 'owned-default', slug: 'todo', is_default: true, is_done: false },
      { id: 'owned-done', slug: 'done', is_default: false, is_done: true },
    ])
    await pointFallbackAt(request, admin, cleanup, project.id)
    expect(routing.currentProjectId()).toBe(ownedProjectId)
  } finally {
    await cleanup.run()
  }
  expect(routing.currentProjectId()).toBe('original-fallback-project')
  expect(routing.events).toEqual([
    `fallback:${ownedProjectId}`, 'fallback:original-fallback-project', `delete:${ownedProjectId}`,
  ])
  expect([...routing.projects.values()]).toEqual(existingProjects)
  expect(deleteEntityIfExists).toHaveBeenCalledWith(request, admin, '/api/customers/companies', 'owned-customer')
  expect(mockApiRequest.mock.calls.some(([, method, pathname]) => method === 'GET' && pathname.startsWith(projectPath))).toBe(false)
})

it('cleans up its project and temporary customer when clearing the customer fails', async () => {
  const routing = setupRouting([], { failCustomerClear: true })
  const cleanup = new Cleanup()
  try {
    await expect(createCustomerFreeProject(request, admin, cleanup)).rejects.toThrow()
  } finally {
    await cleanup.run()
  }
  expect(routing.currentProjectId()).toBe('original-fallback-project')
  expect(routing.projects.size).toBe(0)
  expect(routing.events).toEqual([`delete:${ownedProjectId}`])
  expect(deleteEntityIfExists).toHaveBeenCalledWith(request, admin, '/api/customers/companies', 'owned-customer')
})
