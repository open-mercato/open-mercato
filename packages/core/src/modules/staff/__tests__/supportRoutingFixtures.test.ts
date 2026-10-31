import type { APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { Cleanup, ensureSeededFallback, pointFallbackAt } from '../__integration__/support/fixtures'

jest.mock('@playwright/test', () => ({ expect: (value: unknown) => expect(value) }))
jest.mock('@open-mercato/core/helpers/integration/api', () => ({ apiRequest: jest.fn() }))

const mockApiRequest = jest.mocked(apiRequest)
const request = {} as APIRequestContext
const admin = 'admin-token'

type Project = { id: string; name: string; project_type: string; customer_id: string | null }

function setupRouting(projects: Project[]) {
  let timeProjectId = 'customer-project'
  mockApiRequest.mockImplementation(async (_request, method, pathname, options) => {
    let body: unknown
    if (method === 'POST' && pathname.endsWith('/fallback-project')) {
      body = { ruleId: 'fallback-rule', timeProjectId, created: false }
    } else if (method === 'GET' && pathname.startsWith('/api/staff/timesheets/time-projects?')) {
      body = { items: projects }
    } else if (method === 'PUT' && pathname === '/api/staff/timesheets/support-routing-rules') {
      timeProjectId = (options?.data as { timeProjectId: string }).timeProjectId
      body = { ok: true }
    } else {
      throw new Error(`[internal] unexpected fixture request: ${method} ${pathname}`)
    }
    return { ok: () => true, status: () => 200, text: async () => JSON.stringify(body) } as Awaited<ReturnType<typeof apiRequest>>
  })
  return { currentProjectId: () => timeProjectId }
}

const seededProject: Project = {
  id: 'seeded-project',
  name: 'Customer support',
  project_type: 'internal',
  customer_id: null,
}

beforeEach(() => {
  mockApiRequest.mockReset()
})

it('routes to the seeded project after another test changed the fallback, then restores that target', async () => {
  const routing = setupRouting([
    { id: 'customer-project', name: 'QA Support lifecycle', project_type: 'client', customer_id: 'customer' },
    { id: 'similar-project', name: 'Customer support extra', project_type: 'internal', customer_id: null },
    seededProject,
  ])
  const cleanup = new Cleanup()
  try {
    const fallback = await ensureSeededFallback(request, admin)
    expect(fallback.timeProjectId).toBe(seededProject.id)
    expect(routing.currentProjectId()).toBe('customer-project')
    await pointFallbackAt(request, admin, cleanup, fallback.timeProjectId)
    expect(routing.currentProjectId()).toBe(seededProject.id)
  } finally {
    await cleanup.run()
  }
  expect(routing.currentProjectId()).toBe('customer-project')
})

it('does not substitute a customer-linked project when the seeded project is missing', async () => {
  setupRouting([{ id: 'customer-project', name: 'QA Support lifecycle', project_type: 'client', customer_id: 'customer' }])
  await expect(ensureSeededFallback(request, admin)).rejects.toThrow()
  expect(mockApiRequest.mock.calls.some(([, method]) => method === 'PUT')).toBe(false)
})

it('refuses ambiguous seeded project names instead of choosing an arbitrary project', async () => {
  setupRouting([seededProject, { ...seededProject, id: 'another-seeded-project' }])
  await expect(ensureSeededFallback(request, admin)).rejects.toThrow()
})
