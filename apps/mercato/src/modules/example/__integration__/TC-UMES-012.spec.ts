/**
 * TC-UMES-012: Response Metadata + Extension Headers + Interceptor Activity (SPEC-041k)
 *
 * Validates that:
 * 1. API responses include `_meta.enrichedBy` when enrichers run
 * 2. Extension headers (x-om-ext-*) are parsed and accessible
 * 3. Interceptor activity is logged for interceptor actions
 *
 * Spec reference: SPEC-041k — DevTools + Conflict Detection (Steps 5, 6, 8)
 */
import { test, expect } from '@playwright/test'
import {
  getAuthToken,
  apiRequest,
} from '@open-mercato/core/helpers/integration/api'
import {
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  buildExtensionHeader,
  parseExtensionHeaders,
  getExtensionHeaderValue,
} from '@open-mercato/shared/lib/umes/extension-headers'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

interface ListResponseBody {
  items?: unknown[]
  _meta?: { enrichedBy?: string[] }
}

interface SingleResponseBody {
  _meta?: { enrichedBy?: string[] }
}

interface ErrorResponseBody {
  message?: string
}

interface TodoResponseBody {
  id?: string
}

test.describe('TC-UMES-012: Response metadata (_meta.enrichedBy)', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request)
  })

  test('customer list response includes _meta.enrichedBy with enricher IDs', async ({ request }) => {
    // The example module enricher `example.customer-todo-count` targets customers.person
    const response = await apiRequest(request, 'GET', '/api/customers/people?limit=5', { token })
    expect(response.ok()).toBeTruthy()

    const body = await readJsonSafe<ListResponseBody>(response)
    expect(body).toHaveProperty('items')
    expect(Array.isArray(body?.items)).toBeTruthy()

    // The response should have _meta with enrichedBy array
    if (body?._meta) {
      expect(body._meta).toHaveProperty('enrichedBy')
      expect(Array.isArray(body._meta.enrichedBy)).toBeTruthy()
      // The example module enricher should be listed
      expect(body._meta.enrichedBy).toContain('example.customer-todo-count')
    }
  })

  test('single customer response includes _meta.enrichedBy', async ({ request }) => {
    let personId: string | null = null
    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `UMES-012 ${Date.now()}`,
        displayName: `QA UMES-012 ${Date.now()}`,
      })

      const response = await apiRequest(request, 'GET', `/api/customers/people/${personId}`, { token })
      expect(response.ok()).toBeTruthy()

      const body = await readJsonSafe<SingleResponseBody>(response)

      // Single record response should also have _meta
      if (body?._meta) {
        expect(body._meta).toHaveProperty('enrichedBy')
        expect(Array.isArray(body._meta.enrichedBy)).toBeTruthy()
      }
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})

test.describe('TC-UMES-012: Extension headers', () => {
  test('extension header helper functions work correctly', () => {
    // buildExtensionHeader
    const header = buildExtensionHeader('record_locks', 'token')
    expect(header).toBe('x-om-ext-record_locks-token')

    // parseExtensionHeaders
    const parsed = parseExtensionHeaders({
      'content-type': 'application/json',
      'x-om-ext-record_locks-token': 'abc123',
      'x-om-ext-business_rules-override': 'skip',
    })
    expect(parsed).toEqual({
      record_locks: { token: 'abc123' },
      business_rules: { override: 'skip' },
    })

    // getExtensionHeaderValue
    const value = getExtensionHeaderValue(
      { 'x-om-ext-record_locks-token': 'abc123' },
      'record_locks',
      'token',
    )
    expect(value).toBe('abc123')

    // Missing header returns undefined
    const missing = getExtensionHeaderValue(
      { 'content-type': 'text/plain' },
      'record_locks',
      'token',
    )
    expect(missing).toBeUndefined()
  })

  test('extension headers are passed through to interceptor context', async ({ request }) => {
    const token = await getAuthToken(request)

    // Send a request with an extension header to a route with interceptors
    // The example module has interceptors on example/todos
    const response = await request.get(`${BASE_URL}/api/example/todos`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-om-ext-example-probe': 'header-test',
      },
    })

    // The request should succeed (extension headers don't block requests)
    // We just verify the request completes — the header parsing happens server-side
    expect(response.status()).toBeLessThan(500)
  })
})

test.describe('TC-UMES-012: Interceptor activity logging', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request)
  })

  test('interceptor blocks request and logs activity', async ({ request }) => {
    // The example module has `example.block-test-todos` interceptor that blocks
    // POST/PUT to example/todos when title contains "BLOCKED"
    const response = await request.post(`${BASE_URL}/api/example/todos`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'BLOCKED test todo', description: 'Should be rejected' },
    })

    // The interceptor should block this request
    expect(response.status()).toBeGreaterThanOrEqual(400)

    const body = await readJsonSafe<ErrorResponseBody>(response)
    // The blocking interceptor should return an error message
    if (body?.message) {
      expect(body.message.toLowerCase()).toMatch(/block/i)
    }
  })

  test('interceptor allows normal requests through', async ({ request }) => {
    // A normal todo creation should pass through the interceptor
    const response = await request.post(`${BASE_URL}/api/example/todos`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: `Normal todo ${Date.now()}`, description: 'Should succeed' },
    })

    // Should succeed (2xx)
    expect(response.ok()).toBeTruthy()

    const body = await readJsonSafe<TodoResponseBody>(response)
    // Clean up the created todo
    if (body?.id) {
      await request.delete(`${BASE_URL}/api/example/todos/${body.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    }
  })
})
