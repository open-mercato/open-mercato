import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CRM-097: a list route that relies on makeCrudRoute's default advanced-filter merge
 * honours the v2 tree query shape (`filter[v]=2&filter[root][...]`) the same way it
 * honours the legacy v1 flat shape.
 */
async function listIds(request: APIRequestContext, token: string, params: Record<string, string>): Promise<string[]> {
  const query = new URLSearchParams({ pageSize: '100', ...params })
  const response = await apiRequest(request, 'GET', `/api/customers/tags?${query}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ id?: unknown }> }>(response)
  return (body?.items ?? [])
    .map((item) => item.id)
    .filter((id): id is string => typeof id === 'string')
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

function v2Rule(index: number, label: string): Record<string, string> {
  const prefix = `filter[root][children][${index}]`
  return {
    [`${prefix}[type]`]: 'rule',
    [`${prefix}[field]`]: 'label',
    [`${prefix}[op]`]: 'is',
    [`${prefix}[value]`]: label,
  }
}

test.describe('TC-CRM-097: v2 advanced filter on a default-merge list route', () => {
  test('filters /api/customers/tags by a v2 tree and by the legacy v1 shape', async ({ request }) => {
    let token: string | null = null
    const tagIds: string[] = []
    const stamp = Date.now()
    const labels = [`QA TC-CRM-097 A ${stamp}`, `QA TC-CRM-097 B ${stamp}`]

    try {
      token = await getAuthToken(request)

      for (const [index, label] of labels.entries()) {
        const response = await apiRequest(request, 'POST', '/api/customers/tags', {
          token,
          data: { slug: `qa-tc-crm-097-${index}-${stamp}`, label },
        })
        expect(response.ok()).toBeTruthy()
        tagIds.push(expectId((await readJsonSafe<{ id?: unknown }>(response))?.id, 'Expected created tag id'))
      }
      const [firstId, secondId] = tagIds

      expect(await listIds(request, token, {
        'filter[v]': '2',
        'filter[root][combinator]': 'and',
        ...v2Rule(0, labels[0]),
      })).toEqual([firstId])

      expect(await listIds(request, token, {
        'filter[v]': '2',
        'filter[root][combinator]': 'or',
        ...v2Rule(0, labels[0]),
        ...v2Rule(1, labels[1]),
      })).toEqual([firstId, secondId].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)))

      expect(await listIds(request, token, {
        'filter[conditions][0][field]': 'label',
        'filter[conditions][0][op]': 'is',
        'filter[conditions][0][value]': labels[1],
      })).toEqual([secondId])
    } finally {
      for (const id of tagIds) {
        await deleteGeneralEntityIfExists(request, token, '/api/customers/tags', id)
      }
    }
  })
})
