import type { APIRequestContext, APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { withIsolatedAddressEncryptionActor } from '../addressEncryptionFixtures'

jest.mock('@playwright/test', () => ({ expect: (value: unknown) => expect(value) }))
jest.mock('@open-mercato/core/helpers/integration/api', () => ({ apiRequest: jest.fn(), getAuthToken: jest.fn() }))
jest.mock('@open-mercato/core/helpers/integration/dbFixtures', () => ({ withClient: jest.fn() }))

const request = {} as APIRequestContext
const cleanupRoutes = ['/api/auth/users', '/api/auth/roles', '/api/directory/organizations', '/api/directory/tenants']
let refusal: { route: string; transport: boolean } | undefined
let alreadyAbsent: boolean
let resources: Array<{ route: string; id: string }>
let deletes: Array<{ route: string; id: string | undefined }>
let policyScopes: unknown[]

function response(status: number, body: unknown): APIResponse {
  return { status: () => status, ok: () => status >= 200 && status < 300, text: async () => JSON.stringify(body), json: async () => body } as unknown as APIResponse
}

beforeEach(() => {
  refusal = undefined
  alreadyAbsent = false
  resources = []
  deletes = []
  policyScopes = []
  jest.mocked(getAuthToken).mockImplementation(async (_request, identity) => identity === 'superadmin' ? 'super-token' : 'actor-token')
  jest.mocked(apiRequest).mockImplementation(async (_request, method, route, options) => {
    const endpoint = route.split('?')[0]
    if (method === 'DELETE') {
      const payload = options?.data as { id?: string } | undefined
      deletes.push({ route: endpoint, id: payload?.id ?? new URL(route, 'https://test.invalid').searchParams.get('id') ?? undefined })
      if (refusal?.route === endpoint) {
        if (refusal.transport) throw new Error('[internal] Fixture transport failure')
        return response(403, {})
      }
      return response(alreadyAbsent ? 404 : 200, {})
    }
    if (method === 'PUT') return response(200, { ok: true })
    const id = `owned-${resources.length + 1}`
    resources.push({ route: endpoint, id })
    return response(201, { id })
  })
  jest.mocked(withClient).mockImplementation(async (run) => run({ query: async (_sql, values) => {
    policyScopes.push(values?.[0])
    return { rows: [], rowCount: 0 }
  } }))
})

function expectAllOwnedCleanup() {
  expect(deletes).toEqual(resources.map(({ route, id }) => ({ route, id })).sort((left, right) => {
    const order = ['/api/auth/users', '/api/auth/roles', '/api/directory/organizations', '/api/directory/tenants']
    return order.indexOf(left.route) - order.indexOf(right.route)
  }))
  expect(policyScopes).toEqual(resources.filter((resource) => resource.route === '/api/directory/tenants').map((resource) => resource.id))
}

it.each(cleanupRoutes.flatMap((route) => [{ route, transport: false }, { route, transport: true }]))(
  'reports refused cleanup and attempts all owned resources: $route transport=$transport',
  async (failure) => {
    refusal = failure
    await expect(withIsolatedAddressEncryptionActor(request, async () => {})).rejects.toBeInstanceOf(AggregateError)
    expectAllOwnedCleanup()
  },
)

it('accepts already absent owned fixtures', async () => {
  alreadyAbsent = true
  await withIsolatedAddressEncryptionActor(request, async () => {})
  expectAllOwnedCleanup()
})

it('attempts all owned cleanup after a test body fails', async () => {
  const failure = new Error('[internal] Fixture body failure')
  await expect(withIsolatedAddressEncryptionActor(request, async () => { throw failure })).rejects.toBe(failure)
  expectAllOwnedCleanup()
})
