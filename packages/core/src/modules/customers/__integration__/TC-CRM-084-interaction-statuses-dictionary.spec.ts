import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CRM-084: Interaction-statuses dictionary CRUD.
 *
 * Spec: .ai/specs/2026-06-18-configurable-crm-interaction-statuses.md
 *   - GET /api/customers/dictionaries/interaction-statuses returns the seeded
 *     canonical set (planned, in_progress, waiting, done, canceled).
 *   - POST/PATCH/DELETE manage a tenant-custom status (parity with deal-statuses).
 *
 * The seeded-set check exercises the Phase 3 `seedCustomerDictionaries` loop, which
 * runs during tenant init (not demo examples). The custom-status round-trip is fully
 * self-contained and cleaned up in `finally`.
 */
const KIND_PATH = '/api/customers/dictionaries/interaction-statuses'

type DictionaryItem = { id?: string; value?: string; label?: string; color?: string | null }

async function listStatuses(request: Parameters<typeof apiRequest>[0], token: string): Promise<DictionaryItem[]> {
  const res = await apiRequest(request, 'GET', KIND_PATH, { token })
  expect(res.ok(), `GET ${KIND_PATH} returned ${res.status()}`).toBeTruthy()
  const body = (await res.json().catch(() => null)) as { items?: DictionaryItem[] } | null
  return Array.isArray(body?.items) ? body.items : []
}

test.describe('TC-CRM-084: Interaction statuses dictionary', () => {
  test('exposes the seeded canonical statuses', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const values = new Set((await listStatuses(request, token)).map((item) => item.value))
    for (const expected of ['planned', 'in_progress', 'waiting', 'done', 'canceled']) {
      expect(values.has(expected), `interaction-statuses dictionary MUST seed "${expected}"`).toBeTruthy()
    }
  })

  test('creates, edits, and deletes a tenant-custom status', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const value = `qa_blocked_${Date.now()}`
    let createdId: string | null = null

    try {
      const createRes = await apiRequest(request, 'POST', KIND_PATH, {
        token,
        data: { value, label: 'QA Blocked', color: '#a855f7', icon: 'lucide:pause-circle' },
      })
      expect(createRes.ok(), `POST ${KIND_PATH} returned ${createRes.status()}`).toBeTruthy()
      const created = (await createRes.json().catch(() => null)) as { id?: string } | null
      createdId = created?.id ?? null
      expect(createdId, 'create response should expose an id').toBeTruthy()

      const afterCreate = await listStatuses(request, token)
      expect(afterCreate.some((item) => item.value === value), 'custom status should be listed after create').toBeTruthy()

      const patchRes = await apiRequest(request, 'PATCH', `${KIND_PATH}/${createdId}`, {
        token,
        data: { label: 'QA Blocked (edited)' },
      })
      expect(patchRes.ok(), `PATCH ${KIND_PATH}/{id} returned ${patchRes.status()}`).toBeTruthy()
      const afterPatch = await listStatuses(request, token)
      expect(
        afterPatch.find((item) => item.value === value)?.label,
        'custom status label should reflect the edit',
      ).toBe('QA Blocked (edited)')

      const deleteRes = await apiRequest(request, 'DELETE', `${KIND_PATH}/${createdId}`, { token })
      expect(deleteRes.ok(), `DELETE ${KIND_PATH}/{id} returned ${deleteRes.status()}`).toBeTruthy()
      createdId = null
      const afterDelete = await listStatuses(request, token)
      expect(afterDelete.some((item) => item.value === value), 'custom status should be gone after delete').toBeFalsy()
    } finally {
      if (createdId) {
        await apiRequest(request, 'DELETE', `${KIND_PATH}/${createdId}`, { token }).catch(() => {})
      }
    }
  })
})
