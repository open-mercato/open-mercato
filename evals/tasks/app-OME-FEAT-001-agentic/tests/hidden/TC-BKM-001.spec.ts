// FAIL_TO_PASS suite for app-OME-FEAT-001. HIDDEN — injected by the verifier,
// never shown to the agent. Exercises /api/bookmarks over HTTP against the
// running app using the published core integration helpers.
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

test.describe('TC-BKM-001: bookmarks CRUD + gating', () => {
  test('POST {title,url,note} as authorized user -> 2xx, returns id; GET echoes it back', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const title = `QA TC-BKM-001 ${Date.now()}`
    const url = 'https://example.com/article'
    const note = 'read later'
    let id: string | null = null

    try {
      const createRes = await apiRequest(request, 'POST', '/api/bookmarks', { token, data: { title, url, note } })
      expect(createRes.ok(), `create status ${createRes.status()}`).toBe(true)
      const created = (await createRes.json()) as { id?: string }
      expect(typeof created.id).toBe('string')
      id = created.id ?? null

      const listRes = await apiRequest(request, 'GET', `/api/bookmarks?search=${encodeURIComponent(title)}`, { token })
      expect(listRes.status()).toBe(200)
      const list = (await listRes.json()) as { items?: Array<Record<string, unknown>> }
      const found = (list.items ?? []).find((item) => item.id === id)
      expect(found, 'created bookmark present in list').toBeTruthy()
      expect(found!.title).toBe(title)
      expect(found!.url).toBe(url)
      expect(found!.note).toBe(note)
    } finally {
      if (id) await apiRequest(request, 'DELETE', `/api/bookmarks?id=${encodeURIComponent(id)}`, { token }).catch(() => {})
    }
  })

  test('POST without note -> 2xx and note is null (optional)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const title = `QA TC-BKM-001 no-note ${Date.now()}`
    let id: string | null = null

    try {
      const createRes = await apiRequest(request, 'POST', '/api/bookmarks', { token, data: { title, url: 'https://example.org' } })
      expect(createRes.ok(), `create status ${createRes.status()}`).toBe(true)
      const created = (await createRes.json()) as { id?: string }
      id = created.id ?? null

      const listRes = await apiRequest(request, 'GET', `/api/bookmarks?search=${encodeURIComponent(title)}`, { token })
      const list = (await listRes.json()) as { items?: Array<Record<string, unknown>> }
      const found = (list.items ?? []).find((item) => item.id === id)
      expect(found, 'created bookmark present in list').toBeTruthy()
      expect(found!.note ?? null).toBeNull()
    } finally {
      if (id) await apiRequest(request, 'DELETE', `/api/bookmarks?id=${encodeURIComponent(id)}`, { token }).catch(() => {})
    }
  })

  test('POST with invalid url -> 400 validation error', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const res = await apiRequest(request, 'POST', '/api/bookmarks', {
      token,
      data: { title: 'bad url', url: 'not-a-valid-url' },
    })
    expect(res.status()).toBe(400)
  })

  test('GET with NO auth -> 401/403 (feature-gated)', async ({ request }) => {
    const res = await request.get('/api/bookmarks')
    expect([401, 403]).toContain(res.status())
  })
})
