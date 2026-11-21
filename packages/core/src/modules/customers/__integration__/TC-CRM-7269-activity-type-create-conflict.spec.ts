import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const activityTypesPath = '/api/customers/dictionaries/activity-types'

type DictionaryEntry = { id: string; value: string; label: string; updatedAt: string }

test('concurrent versionless activity-type POSTs save a single winner', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const value = `qa_${randomUUID()}`
  const createdIds: string[] = []

  try {
    const writes = await Promise.all(['First draft', 'Second draft'].map(async (label) => {
      const response = await apiRequest(request, 'POST', activityTypesPath, {
        token,
        data: { value, label },
      })
      const status = response.status()
      const body = await readJsonSafe<Partial<DictionaryEntry>>(response)
      if (status === 201) createdIds.push(expectId(body?.id, 'Expected the created activity-type ID'))
      return { status, body, label }
    }))

    expect(writes.map(({ status }) => status).sort()).toEqual([201, 409])
    const winner = writes.find(({ status }) => status === 201)!
    const loser = writes.find(({ status }) => status === 409)!
    expect(winner.body).toMatchObject({ value, label: winner.label, updatedAt: expect.any(String) })
    const conflict = {
      error: 'record_modified',
      code: 'optimistic_lock_conflict',
      currentUpdatedAt: winner.body?.updatedAt,
      expectedUpdatedAt: winner.body?.updatedAt,
    }
    expect(loser.body).toEqual(conflict)

    const retry = await apiRequest(request, 'POST', activityTypesPath, {
      token,
      data: { value, label: loser.label },
    })
    expect(retry.status()).toBe(409)
    expect(await readJsonSafe(retry)).toEqual(conflict)

    const listed = await apiRequest(request, 'GET', `${activityTypesPath}?labels=base`, { token })
    expect(listed.status()).toBe(200)
    const dictionary = await readJsonSafe<{ items: DictionaryEntry[] }>(listed)
    expect(dictionary?.items.filter((entry) => entry.value === value)).toEqual([
      expect.objectContaining({ id: winner.body?.id, label: winner.label, updatedAt: winner.body?.updatedAt }),
    ])
  } finally {
    for (const id of createdIds) {
      const deleted = await apiRequest(request, 'DELETE', `${activityTypesPath}/${id}`, { token })
      expect(deleted.status(), await deleted.text()).toBe(200)
    }
  }
})
