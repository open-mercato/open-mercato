import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-DASH-014 — security regression coverage for #10331 and #10332.
 *
 * 1. Sends synthetic reserved extension headers (`x-om-ext-__proto__-*`,
 *    `x-om-ext-constructor-*`, `x-om-ext-prototype-*`) to an authenticated
 *    CRUD-factory route (`/api/customers/people`), then confirms subsequent
 *    independent CRUD and analytics requests remain completely healthy.
 * 2. Verifies analytics widget-data single and batch endpoints reject inherited
 *    or undeclared field names while preserving valid aggregations.
 */
test.describe('TC-DASH-014: Extension header & analytics identifier hardening (#10331, #10332)', () => {
  test('reserved extension headers on a CRUD route do not poison subsequent CRUD or analytics requests', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const probeResponse = await apiRequest(request, 'GET', '/api/customers/people?limit=1', {
      token,
      headers: {
        'x-om-ext-__proto__-schema': 'evil schema',
        'x-om-ext-__proto__-polluted': 'true',
        'x-om-ext-constructor-prototype': 'polluted',
        'x-om-ext-prototype-polluted': 'true',
        'x-om-ext-record_locks-token': 'legitimate-token',
      },
    })
    expect(probeResponse.status()).toBe(200)

    const followUpCrud = await apiRequest(request, 'GET', '/api/customers/people?limit=1', { token })
    expect(followUpCrud.status()).toBe(200)
    const crudBody = await readJsonSafe<{ items?: unknown[] }>(followUpCrud)
    expect(Array.isArray(crudBody?.items)).toBe(true)

    const validAnalytics = await apiRequest(request, 'POST', '/api/dashboards/widgets/data', {
      token,
      data: {
        entityType: 'customers:entities',
        metric: { field: 'id', aggregate: 'count' },
      },
    })
    expect(validAnalytics.status()).toBe(200)
    const validBody = await readJsonSafe<{ value?: number | null }>(validAnalytics)
    expect(typeof validBody?.value === 'number' || validBody?.value === null).toBe(true)

    const inheritedField = await apiRequest(request, 'POST', '/api/dashboards/widgets/data', {
      token,
      data: {
        entityType: 'customers:entities',
        metric: { field: 'toString', aggregate: 'count' },
      },
    })
    expect(inheritedField.status()).toBe(400)

    const batchResponse = await apiRequest(request, 'POST', '/api/dashboards/widgets/data/batch', {
      token,
      data: {
        requests: [
          {
            id: 'inherited-field',
            request: {
              entityType: 'customers:entities',
              metric: { field: 'constructor', aggregate: 'count' },
            },
          },
          {
            id: 'valid-field',
            request: {
              entityType: 'customers:entities',
              metric: { field: 'id', aggregate: 'count' },
            },
          },
        ],
      },
    })
    expect(batchResponse.status()).toBe(200)
    const batchBody = await readJsonSafe<{ results?: Array<{ id: string; ok: boolean }> }>(batchResponse)
    expect(batchBody?.results).toEqual([
      expect.objectContaining({ id: 'inherited-field', ok: false }),
      expect.objectContaining({ id: 'valid-field', ok: true }),
    ])
  })
})
