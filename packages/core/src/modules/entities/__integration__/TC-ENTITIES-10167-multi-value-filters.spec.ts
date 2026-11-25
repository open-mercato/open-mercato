import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCustomEntity, createRecord, listRecords, saveFieldDefinitions, uniqueEntityId } from './helpers/entitiesApi'

/**
 * TC-ENTITIES-10167: `GET /api/entities/records` filters a multi-value custom field by one of its
 * values, for one value (`cf_<key>=`) and for a list (`cf_<key>In=`).
 */

async function filteredTitles(request: APIRequestContext, token: string, entityId: string, filter: string) {
  const response = await listRecords(request, token, entityId, filter)
  expect(response.status()).toBe(200)
  const body = await response.json() as { items: Array<{ title: string }>; total: number }
  expect(body.total).toBe(body.items.length)
  return body.items.map((item) => item.title).sort()
}

test.describe('TC-ENTITIES-10167: multi-value custom-field filters on custom entity records', () => {
  test('matches records by any value of a multi-value field', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const entityId = uniqueEntityId('multi_filter')
    const recordIds: string[] = []
    const fieldKeys: string[] = []
    let entityCreated = false
    try {
      const entity = await createCustomEntity(request, token, { entityId, label: 'QA multi-value filters' })
      expect(entity.status()).toBe(200)
      entityCreated = true
      const fields = await saveFieldDefinitions(request, token, entityId, [
        { key: 'title', kind: 'text', configJson: { label: 'Title', formEditable: true } },
        { key: 'labels', kind: 'text', configJson: { label: 'Labels', multi: true, input: 'tags', filterable: true } },
      ])
      expect(fields.status()).toBe(200)
      fieldKeys.push('title', 'labels')
      for (const values of [
        { title: 'Labels a and b', labels: ['a', 'b'] },
        { title: 'Label b', labels: ['b'] },
        { title: 'Label c', labels: ['c'] },
        { title: 'No labels' },
      ]) {
        const created = await createRecord(request, token, entityId, values)
        expect(created.status()).toBe(200)
        const body = await created.json() as { item: { recordId: string } }
        recordIds.push(body.item.recordId)
      }

      expect(await filteredTitles(request, token, entityId, '&cf_labels=a')).toEqual(['Labels a and b'])
      expect(await filteredTitles(request, token, entityId, '&cf_labels=b')).toEqual(['Label b', 'Labels a and b'])
      expect(await filteredTitles(request, token, entityId, '&cf_labelsIn=a,c')).toEqual(['Label c', 'Labels a and b'])
      expect(await filteredTitles(request, token, entityId, '&cf_labels=missing')).toEqual([])
    } finally {
      const deletions = [
        ...recordIds.map((recordId) => ({ path: '/api/entities/records', data: { entityId, recordId } })),
        ...fieldKeys.map((key) => ({ path: '/api/entities/definitions', data: { entityId, key } })),
        ...(entityCreated ? [{ path: '/api/entities/entities', data: { entityId } }] : []),
      ]
      const failures: string[] = []
      for (const { path, data } of deletions) {
        try {
          const response = await apiRequest(request, 'DELETE', path, { token, data })
          if (response.status() !== 200) failures.push(`${path} ${JSON.stringify(data)}: ${response.status()}`)
        } catch (error) {
          failures.push(`${path} ${JSON.stringify(data)}: ${String(error)}`)
        }
      }
      expect.soft(failures, 'every fixture is deleted').toEqual([])
    }
  })
})
