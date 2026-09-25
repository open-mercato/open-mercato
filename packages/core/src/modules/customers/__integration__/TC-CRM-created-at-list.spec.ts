import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-created-at-list: People and companies lists sort and filter by creation date.
 *
 * Fixtures get explicit `created_at` values, so the spec never depends on the wall clock:
 * - EARLIER is mid-day on 2026-01-15 UTC.
 * - NEAR_MIDNIGHT is 23:30 UTC on 2026-01-16, which is already 2026-01-17 in Europe/Warsaw.
 *
 * Bare dates sent to the list APIs name UTC days. The list pages send instant bounds for the
 * reader's time zone instead, so a record is found on the day its Created cell shows.
 */

const EARLIER = '2026-01-15T10:00:00.000Z'
const NEAR_MIDNIGHT = '2026-01-16T23:30:00.000Z'

type ListItem = { id?: string; created_at?: string | null }
type ListResponse = { items?: ListItem[] }

type Rule = { field: string; op: string; value: string | [string, string] }

function filterParams(rules: Rule[]): URLSearchParams {
  const params = new URLSearchParams()
  params.set('filter[v]', '2')
  params.set('filter[root][combinator]', 'and')
  rules.forEach((rule, index) => {
    const prefix = `filter[root][children][${index}]`
    params.set(`${prefix}[type]`, 'rule')
    params.set(`${prefix}[field]`, rule.field)
    params.set(`${prefix}[op]`, rule.op)
    params.set(`${prefix}[value]`, typeof rule.value === 'string' ? rule.value : JSON.stringify(rule.value))
  })
  return params
}

async function listIds(
  request: APIRequestContext,
  token: string,
  path: string,
  params: URLSearchParams,
): Promise<string[]> {
  params.set('pageSize', '100')
  const response = await apiRequest(request, 'GET', `${path}?${params.toString()}`, { token })
  expect(response.ok(), `GET ${path} should succeed (${response.status()})`).toBeTruthy()
  const body = (await readJsonSafe(response)) as ListResponse | null
  const items = Array.isArray(body?.items) ? body!.items! : []
  return items.map((item) => String(item.id))
}

async function setCreatedAt(entityId: string, createdAt: string): Promise<void> {
  await withClient(async (client) => {
    const result = await client.query('update customer_entities set created_at = $1 where id = $2', [createdAt, entityId])
    expect(result.rowCount, `created_at fixture should update entity ${entityId}`).toBe(1)
  })
}

type Surface = {
  label: string
  path: string
  create: (request: APIRequestContext, token: string, name: string) => Promise<string>
}

const surfaces: Surface[] = [
  {
    label: 'companies',
    path: '/api/customers/companies',
    create: (request, token, name) => createCompanyFixture(request, token, name),
  },
  {
    label: 'people',
    path: '/api/customers/people',
    create: (request, token, name) =>
      createPersonFixture(request, token, { firstName: name, lastName: 'CreatedAt', displayName: name }),
  },
]

test.describe('TC-CRM-created-at-list: sort and filter people/companies by creation date', () => {
  for (const surface of surfaces) {
    test(`${surface.label}: sorts by createdAt and filters created_at by whole days`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      const marker = `TCCreatedAt${surface.label}${Date.now()}`
      const createdIds: string[] = []
      try {
        const nearMidnightId = await surface.create(request, token, `${marker} NearMidnight`)
        createdIds.push(nearMidnightId)
        const earlierId = await surface.create(request, token, `${marker} Earlier`)
        createdIds.push(earlierId)
        await setCreatedAt(nearMidnightId, NEAR_MIDNIGHT)
        await setCreatedAt(earlierId, EARLIER)

        const nameRule: Rule = { field: 'display_name', op: 'contains', value: marker }
        const list = (...rules: Rule[]) => listIds(request, token, surface.path, filterParams([nameRule, ...rules]))

        const ascParams = filterParams([nameRule])
        ascParams.set('sortField', 'createdAt')
        ascParams.set('sortDir', 'asc')
        expect(await listIds(request, token, surface.path, ascParams)).toEqual([earlierId, nearMidnightId])

        const descParams = filterParams([nameRule])
        descParams.set('sortField', 'createdAt')
        descParams.set('sortDir', 'desc')
        expect(await listIds(request, token, surface.path, descParams)).toEqual([nearMidnightId, earlierId])

        expect(await list({ field: 'created_at', op: 'is', value: '2026-01-15' })).toEqual([earlierId])
        expect(await list({ field: 'created_at', op: 'is', value: '2026-01-16' })).toEqual([nearMidnightId])
        expect(await list({ field: 'created_at', op: 'is', value: '2026-01-17' })).toEqual([])
        expect((await list({ field: 'created_at', op: 'between', value: ['2026-01-15', '2026-01-16'] })).sort())
          .toEqual([earlierId, nearMidnightId].sort())
        expect(await list({ field: 'created_at', op: 'is_after', value: '2026-01-15' })).toEqual([nearMidnightId])
        expect(await list({ field: 'created_at', op: 'is_before', value: '2026-01-16' })).toEqual([earlierId])

        expect(await list({
          field: 'created_at',
          op: 'between',
          value: ['2026-01-16T23:00:00.000Z', '2026-01-17T22:59:59.999Z'],
        })).toEqual([nearMidnightId])
      } finally {
        for (const id of createdIds) {
          await deleteEntityIfExists(request, token, surface.path, id)
        }
      }
    })
  }

  test.describe('in a non-UTC browser time zone', () => {
    test.use({ timezoneId: 'Europe/Warsaw', locale: 'en-US' })

    test('companies list finds a near-midnight record on the day its Created cell shows', async ({ page, request }) => {
      const token = await getAuthToken(request, 'admin')
      const marker = `TCCreatedAtUi${Date.now()}`
      let companyId: string | null = null
      try {
        companyId = await createCompanyFixture(request, token, marker)
        await setCreatedAt(companyId, NEAR_MIDNIGHT)
        await login(page, 'admin')

        const query = filterParams([
          { field: 'display_name', op: 'contains', value: marker },
          { field: 'created_at', op: 'is', value: '2026-01-17' },
        ])
        await page.goto(`/backend/customers/companies?${query.toString()}`)
        const row = page.getByRole('row').filter({ hasText: marker })
        await expect(row).toBeVisible()
        await expect(row).toContainText('1/17/2026')

        const sortButton = page.getByRole('button', { name: 'Created', exact: true })
        await sortButton.scrollIntoViewIfNeeded()
        await sortButton.click()
        await expect(page).toHaveURL(/sortField=createdAt/)
      } finally {
        await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
      }
    })
  })
})
