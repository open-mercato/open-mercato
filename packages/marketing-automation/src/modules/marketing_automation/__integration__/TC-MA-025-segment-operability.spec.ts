import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const SEGMENTS_PATH = '/api/marketing_automation/segments'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

type SegmentBody = { id?: string; slug?: string; name?: string; updatedAt?: string }

async function createSegment(request: Parameters<typeof apiRequest>[0], token: string, name: string, expression: unknown) {
  const response = await apiRequest(request, 'POST', SEGMENTS_PATH, { token, data: { name, expression } })
  expect(response.status()).toBe(200)
  return (await readJsonSafe<SegmentBody>(response))!
}

async function removeSegment(request: Parameters<typeof apiRequest>[0], token: string, segment: SegmentBody | null) {
  if (!segment?.id || !segment.updatedAt) return
  await apiRequest(request, 'DELETE', `${SEGMENTS_PATH}/${segment.id}`, {
    token,
    headers: { [LOCK_HEADER]: segment.updatedAt },
  })
}

/**
 * TC-MA-025: what makes segments operable — overlap, size history, bulk actions, export.
 *
 * Each assertion is about the honesty of the answer as much as its value: an overlap of two samples must say
 * it is a sample, and an export must say whether the file is the whole segment.
 */
test.describe('TC-MA-025 segment operability', () => {
  test('two segments can be compared, and the answer says whether it is exact', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let everybody: SegmentBody | null = null
    let buyers: SegmentBody | null = null

    try {
      everybody = await createSegment(request, token, `TC MA 025 everybody ${stamp}`, null)
      buyers = await createSegment(request, token, `TC MA 025 buyers ${stamp}`, {
        operator: 'AND',
        rules: [{ field: 'orders.count', operator: '>=', value: 1 }],
      })

      const response = await apiRequest(request, 'GET', `${SEGMENTS_PATH}/overlap?a=${everybody.id}&b=${buyers.id}`, { token })
      expect(response.status()).toBe(200)
      const overlap = await readJsonSafe<{ a?: { size?: number }; b?: { size?: number }; both?: number; qualifier?: string }>(response)

      expect(typeof overlap?.both).toBe('number')
      // Everybody contains every buyer, so the overlap is exactly the buyer count — whatever this
      // installation happens to hold.
      expect(overlap?.both).toBe(overlap?.b?.size)
      expect((overlap?.a?.size ?? 0)).toBeGreaterThanOrEqual(overlap?.b?.size ?? 0)
      expect(['exact', 'sample']).toContain(overlap?.qualifier)
    } finally {
      await removeSegment(request, token, buyers)
      await removeSegment(request, token, everybody)
    }
  })

  test('comparing a segment with itself is refused rather than answered trivially', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let segment: SegmentBody | null = null
    try {
      segment = await createSegment(request, token, `TC MA 025 self ${Date.now()}`, null)
      const response = await apiRequest(request, 'GET', `${SEGMENTS_PATH}/overlap?a=${segment.id}&b=${segment.id}`, { token })
      expect(response.status()).toBe(400)
      expect((await readJsonSafe<{ code?: string }>(response))?.code).toBe('marketing_automation.errors.overlapSameSegment')
    } finally {
      await removeSegment(request, token, segment)
    }
  })

  test('size history answers with a series, empty until the daily pass has run', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let segment: SegmentBody | null = null
    try {
      segment = await createSegment(request, token, `TC MA 025 history ${Date.now()}`, null)
      const response = await apiRequest(request, 'GET', `${SEGMENTS_PATH}/${segment.id}/history`, { token })
      expect(response.status()).toBe(200)
      const body = await readJsonSafe<{ items?: Array<{ day?: string; size?: number; qualifier?: string }> }>(response)
      expect(Array.isArray(body?.items)).toBe(true)

      const malformed = (body?.items ?? []).filter((point) => !point.day || typeof point.size !== 'number')
      expect(malformed).toEqual([])
    } finally {
      await removeSegment(request, token, segment)
    }
  })

  test('a bulk action is queued with a progress job rather than done in the request', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let segment: SegmentBody | null = null
    try {
      // A segment nobody is in: the assertion is about the CONTRACT — 202 and a job id — not about the work.
      segment = await createSegment(request, token, `TC MA 025 action ${Date.now()}`, {
        operator: 'AND',
        rules: [{ field: 'tags', operator: 'CONTAINS', value: `tc-ma-025-nobody-${Date.now()}` }],
      })

      const response = await apiRequest(request, 'POST', `${SEGMENTS_PATH}/${segment.id}/actions`, {
        token,
        data: { kind: 'add_points', points: 5, reason: 'TC-MA-025' },
      })
      if (response.status() === 503) {
        expect((await readJsonSafe<{ code?: string }>(response))?.code).toBe('marketing_automation.errors.progressUnavailable')
        return
      }
      expect(response.status()).toBe(202)
      const body = await readJsonSafe<{ ok?: boolean; progressJobId?: string }>(response)
      expect(body?.ok).toBe(true)
      expect(body?.progressJobId).toBeTruthy()
    } finally {
      await removeSegment(request, token, segment)
    }
  })

  test('a bulk action with an unusable payload is refused before anything is queued', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let segment: SegmentBody | null = null
    try {
      segment = await createSegment(request, token, `TC MA 025 bad action ${Date.now()}`, null)
      for (const data of [{ kind: 'add_points', points: 0 }, { kind: 'add_tag' }, { kind: 'nonsense' }]) {
        const response = await apiRequest(request, 'POST', `${SEGMENTS_PATH}/${segment.id}/actions`, { token, data })
        expect(response.status()).toBe(400)
      }
    } finally {
      await removeSegment(request, token, segment)
    }
  })

  test('export answers CSV and says whether the file is the whole segment', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let segment: SegmentBody | null = null
    try {
      segment = await createSegment(request, token, `TC MA 025 export ${Date.now()}`, null)
      const response = await apiRequest(request, 'GET', `${SEGMENTS_PATH}/${segment.id}/export`, { token })
      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toContain('text/csv')
      // A file of customer data must not be cached by anything in between.
      expect(response.headers()['cache-control']).toContain('no-store')
      expect(['true', 'false']).toContain(response.headers()['x-om-segment-export-complete'])

      const text = await response.text()
      expect(text.split('\r\n')[0]).toBe('customer_id,display_name,email')
    } finally {
      await removeSegment(request, token, segment)
    }
  })

  test('an anonymous caller cannot compare, act, export or read history', async ({ request }) => {
    const id = '00000000-0000-0000-0000-000000000000'
    for (const response of [
      await request.get(`${SEGMENTS_PATH}/overlap?a=${id}&b=${id}`),
      await request.get(`${SEGMENTS_PATH}/${id}/history`),
      await request.get(`${SEGMENTS_PATH}/${id}/export`),
      await request.post(`${SEGMENTS_PATH}/${id}/actions`, { data: { kind: 'add_points', points: 1 } }),
    ]) {
      expect([401, 403]).toContain(response.status())
    }
  })
})
