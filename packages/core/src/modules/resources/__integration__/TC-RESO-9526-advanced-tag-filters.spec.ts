import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteGeneralEntityIfExists, expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const tagsPath = '/api/resources/tags'

test('resource tag search intersects an advanced organization filter in the ORM list', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const { organizationId } = getTokenContext(token)
  expect(organizationId).toBeTruthy()
  const label = `QA Tag ${randomUUID()}`
  let tagId: string | null = null

  try {
    const create = await apiRequest(request, 'POST', tagsPath, { token, data: { label } })
    expect(create.status()).toBe(201)
    tagId = expectId((await readJsonSafe<{ id?: string }>(create))?.id, 'Tag creation should return an ID')

    const params = new URLSearchParams({
      search: label,
      'filter[conditions][0][field]': 'organization_id',
      'filter[conditions][0][op]': 'is',
      'filter[conditions][0][value]': organizationId,
    })
    const matching = await apiRequest(request, 'GET', `${tagsPath}?${params}`, { token })
    expect(matching.status()).toBe(200)
    expect((await readJsonSafe<{ items: Array<{ id: string }> }>(matching))?.items.map(({ id }) => id))
      .toEqual([tagId])

    params.set('filter[conditions][0][value]', randomUUID())
    const nonMatching = await apiRequest(request, 'GET', `${tagsPath}?${params}`, { token })
    expect(nonMatching.status()).toBe(200)
    expect((await readJsonSafe<{ items: unknown[] }>(nonMatching))?.items).toEqual([])
  } finally {
    await deleteGeneralEntityIfExists(request, token, tagsPath, tagId)
  }
})
