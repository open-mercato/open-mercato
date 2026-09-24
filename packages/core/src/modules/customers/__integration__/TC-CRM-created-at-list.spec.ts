import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-created-at-list: People and companies lists sort and filter by creation date.
 *
 * The lists expose a "Created" column backed by `created_at`. Sorting maps to
 * `sortField=createdAt`; filtering goes through the advanced filter tree, where the
 * date picker sends date-only values that must cover the whole calendar day
 * (`is <day>`, `between <day> and <day>`) and `is_after <day>` must exclude that day.
 */

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
): Promise<{ ids: string[]; items: ListItem[] }> {
  params.set('pageSize', '100')
  const response = await apiRequest(request, 'GET', `${path}?${params.toString()}`, { token })
  expect(response.ok(), `GET ${path} should succeed (${response.status()})`).toBeTruthy()
  const body = (await readJsonSafe(response)) as ListResponse | null
  const items = Array.isArray(body?.items) ? body!.items! : []
  return { ids: items.map((item) => String(item.id)), items }
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
        createdIds.push(await surface.create(request, token, `${marker} First`))
        await new Promise((resolve) => setTimeout(resolve, 1100))
        createdIds.push(await surface.create(request, token, `${marker} Second`))
        const [firstId, secondId] = createdIds
        const nameRule: Rule = { field: 'display_name', op: 'contains', value: marker }

        const ascParams = filterParams([nameRule])
        ascParams.set('sortField', 'createdAt')
        ascParams.set('sortDir', 'asc')
        const asc = await listIds(request, token, surface.path, ascParams)
        expect(asc.ids).toEqual([firstId, secondId])

        const descParams = filterParams([nameRule])
        descParams.set('sortField', 'createdAt')
        descParams.set('sortDir', 'desc')
        const desc = await listIds(request, token, surface.path, descParams)
        expect(desc.ids).toEqual([secondId, firstId])

        const createdAt = asc.items[0]?.created_at
        expect(typeof createdAt, 'list items should expose created_at').toBe('string')
        const day = new Date(createdAt as string).toISOString().slice(0, 10)

        const isDay = await listIds(request, token, surface.path, filterParams([
          nameRule,
          { field: 'created_at', op: 'is', value: day },
        ]))
        expect(isDay.ids.sort()).toEqual([...createdIds].sort())

        const betweenSameDay = await listIds(request, token, surface.path, filterParams([
          nameRule,
          { field: 'created_at', op: 'between', value: [day, day] },
        ]))
        expect(betweenSameDay.ids.sort()).toEqual([...createdIds].sort())

        const afterDay = await listIds(request, token, surface.path, filterParams([
          nameRule,
          { field: 'created_at', op: 'is_after', value: day },
        ]))
        expect(afterDay.ids).toEqual([])

        const beforeDay = await listIds(request, token, surface.path, filterParams([
          nameRule,
          { field: 'created_at', op: 'is_before', value: day },
        ]))
        expect(beforeDay.ids).toEqual([])
      } finally {
        for (const id of createdIds) {
          await deleteEntityIfExists(request, token, surface.path, id)
        }
      }
    })
  }

  test('companies list shows a sortable Created column', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const marker = `TCCreatedAtUi${Date.now()}`
    let companyId: string | null = null
    try {
      companyId = await createCompanyFixture(request, token, marker)
      await login(page, 'admin')
      await page.goto(`/backend/customers/companies?search=${encodeURIComponent(marker)}`)
      const sortButton = page.getByRole('button', { name: 'Created', exact: true })
      await sortButton.scrollIntoViewIfNeeded()
      await expect(sortButton).toBeVisible()
      await sortButton.click()
      await expect(page).toHaveURL(/sortField=createdAt/)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
