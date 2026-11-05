import type { APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { createTestTimeProject } from '../__integration__/fixtures'
import { Cleanup, createCustomerFreeProject } from '../__integration__/support/fixtures'

jest.mock('@playwright/test', () => ({ expect: (value: unknown) => expect(value) }))
jest.mock('@open-mercato/core/helpers/integration/api', () => ({ apiRequest: jest.fn() }))
jest.mock('../__integration__/fixtures', () => ({ createTestTimeProject: jest.fn() }))

const mockApiRequest = jest.mocked(apiRequest)
const mockCreateTestTimeProject = jest.mocked(createTestTimeProject)
const request = {} as APIRequestContext
const admin = 'admin-token'
const projectCleanup = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  projectCleanup.mockResolvedValue(undefined)
  mockCreateTestTimeProject.mockResolvedValue({
    id: 'dedicated-project',
    name: 'QA Support nocustomer 123456',
    code: 'QS123456',
    customer: { id: 'temporary-customer', displayName: 'Temporary customer', cleanup: jest.fn() },
    cleanup: projectCleanup,
  })
})

it('creates a dedicated customer-free project without relying on missing, renamed, or duplicate seeded project names', async () => {
  mockApiRequest.mockImplementation(async (_request, method, pathname, options) => {
    let body: unknown
    if (method === 'PUT' && pathname === '/api/staff/timesheets/time-projects') {
      body = { id: 'dedicated-project' }
      expect(options?.data).toMatchObject({
        id: 'dedicated-project',
        customerId: null,
        customerSnapshot: null,
      })
    } else if (method === 'GET' && pathname.includes('/api/staff/timesheets/task-statuses?')) {
      body = { items: [{ id: 'status-open', slug: 'open', is_default: true }] }
    } else {
      throw new Error(`[internal] unexpected fixture request: ${method} ${pathname}`)
    }
    return { ok: () => true, status: () => 200, text: async () => JSON.stringify(body) } as Awaited<ReturnType<typeof apiRequest>>
  })

  const cleanup = new Cleanup()
  const project = await createCustomerFreeProject(request, admin, cleanup, 'nocustomer')

  expect(project.id).toBe('dedicated-project')
  expect(mockApiRequest.mock.calls.some(([, method, pathname]) =>
    method === 'GET' && pathname.startsWith('/api/staff/timesheets/time-projects?'))).toBe(false)
  await cleanup.run()
  expect(projectCleanup).toHaveBeenCalledTimes(1)
})

it('rejects a customer-free project whose normal creation did not seed task statuses', async () => {
  mockApiRequest.mockImplementation(async (_request, method, pathname) => {
    const body = method === 'GET' && pathname.includes('/api/staff/timesheets/task-statuses?')
      ? { items: [] }
      : { id: 'dedicated-project' }
    return { ok: () => true, status: () => 200, text: async () => JSON.stringify(body) } as Awaited<ReturnType<typeof apiRequest>>
  })

  const cleanup = new Cleanup()
  await expect(createCustomerFreeProject(request, admin, cleanup, 'nocustomer')).rejects.toThrow()
  await cleanup.run()
  expect(projectCleanup).toHaveBeenCalledTimes(1)
})
