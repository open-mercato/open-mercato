import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCustomEntity, listRecords, saveFieldDefinitions, uniqueEntityId } from './helpers/entitiesApi'

type RecordSnapshot = { id: string; title: string; updatedAt: string }

async function readRecord(request: APIRequestContext, token: string, entityId: string, recordId: string) {
  const response = await listRecords(request, token, entityId, `&id=${encodeURIComponent(recordId)}`)
  expect(response.status()).toBe(200)
  const body = await response.json() as { items: RecordSnapshot[]; total: number }
  expect(body.total).toBe(1)
  expect(body.items).toHaveLength(1)
  expect(body.items[0].updatedAt).toEqual(expect.any(String))
  return body.items[0]
}

async function withRecordFixture(
  request: APIRequestContext,
  run: (token: string, entityId: string, recordId: string) => Promise<void>,
) {
  const token = await getAuthToken(request, 'admin')
  const entityId = uniqueEntityId('create_only')
  const recordId = randomUUID()
  let entityCreated = false
  let fieldCreated = false
  try {
    const entity = await createCustomEntity(request, token, { entityId, label: 'QA create-only record' })
    expect(entity.status()).toBe(200)
    entityCreated = true
    const fields = await saveFieldDefinitions(request, token, entityId, [{
      key: 'title', kind: 'text', configJson: { label: 'Title', formEditable: true },
    }])
    expect(fields.status()).toBe(200)
    fieldCreated = true
    await run(token, entityId, recordId)
  } finally {
    if (entityCreated) {
      for (const suppliedId of new Set([recordId, recordId.toUpperCase()])) {
        const record = await apiRequest(request, 'DELETE', '/api/entities/records', {
          token, data: { entityId, recordId: suppliedId },
        })
        expect([200, 404]).toContain(record.status())
      }
      if (fieldCreated) {
        const field = await apiRequest(request, 'DELETE', '/api/entities/definitions', {
          token, data: { entityId, key: 'title' },
        })
        expect(field.status()).toBe(200)
      }
      const entity = await apiRequest(request, 'DELETE', '/api/entities/entities', { token, data: { entityId } })
      expect(entity.status()).toBe(200)
    }
  }
}

test.describe('TC-ENTITIES-011: custom record POST is create-only', () => {
  test('a stale POST preserves the document and version saved by PUT', async ({ request }) => {
    await withRecordFixture(request, async (token, entityId, recordId) => {
      const created = await apiRequest(request, 'POST', '/api/entities/records', {
        token, data: { entityId, recordId, values: { title: 'Original title' } },
      })
      expect(created.status()).toBe(200)
      const original = await readRecord(request, token, entityId, recordId)
      const updated = await apiRequest(request, 'PUT', '/api/entities/records', {
        token,
        headers: { 'x-om-ext-optimistic-lock-expected-updated-at': original.updatedAt },
        data: { entityId, recordId, values: { title: 'Newer title' } },
      })
      expect(updated.status()).toBe(200)
      const latest = await readRecord(request, token, entityId, recordId)
      expect(latest.title).toBe('Newer title')

      for (const suppliedId of [recordId, recordId.toUpperCase()]) {
        const stalePost = await apiRequest(request, 'POST', '/api/entities/records', {
          token,
          headers: suppliedId === recordId ? {} : { 'x-om-ext-optimistic-lock-expected-updated-at': original.updatedAt },
          data: { entityId, recordId: suppliedId, values: { title: 'Stale title' } },
        })
        expect(stalePost.status()).toBe(409)
        expect(await stalePost.json()).toMatchObject({ code: 'custom_entity_record_exists' })
        expect(await readRecord(request, token, entityId, recordId)).toEqual(latest)
      }

      const deleted = await apiRequest(request, 'DELETE', '/api/entities/records', {
        token, data: { entityId, recordId },
      })
      expect(deleted.status()).toBe(200)
      const resurrect = await apiRequest(request, 'POST', '/api/entities/records', {
        token, data: { entityId, recordId, values: { title: 'Resurrected' } },
      })
      expect(resurrect.status()).toBe(409)
      const afterDelete = await listRecords(request, token, entityId, `&id=${recordId}`)
      expect(afterDelete.status()).toBe(200)
      expect(await afterDelete.json()).toMatchObject({ items: [], total: 0 })
    })
  })

  test('concurrent POSTs for one UUID create exactly one record', async ({ request }) => {
    await withRecordFixture(request, async (token, entityId, recordId) => {
      const titles = ['First contender', 'Second contender']
      const responses = await Promise.all(titles.map((title, index) => apiRequest(
        request, 'POST', '/api/entities/records', {
          token, data: { entityId, recordId: index === 0 ? recordId : recordId.toUpperCase(), values: { title } },
        },
      )))
      expect(responses.map((response) => response.status()).sort()).toEqual([200, 409])
      const winner = responses.findIndex((response) => response.status() === 200)
      const created = await responses[winner].json() as { item: { recordId: string } }
      const stored = await readRecord(request, token, entityId, created.item.recordId)
      expect(stored.title).toBe(titles[winner])
    })
  })
})
