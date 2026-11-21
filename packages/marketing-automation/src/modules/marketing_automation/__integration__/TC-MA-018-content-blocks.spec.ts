import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const BLOCKS_PATH = '/api/marketing_automation/content-blocks'

type BlockBody = { id?: string; key?: string; name?: string; html?: string; updatedAt?: string }

async function removeBlock(request: Parameters<typeof apiRequest>[0], token: string, id: string, updatedAt: string) {
  await apiRequest(request, 'DELETE', `${BLOCKS_PATH}/${id}`, {
    token,
    headers: { 'x-om-ext-optimistic-lock-expected-updated-at': updatedAt },
  })
}

/**
 * TC-MA-018: reusable content blocks.
 *
 * The interesting cases are the ones an author will hit on a shared record: a key somebody already used, a
 * save built on a version that moved, and a key freed by a deletion.
 */
test.describe('TC-MA-018 content blocks', () => {
  test('a block is created, listed, edited and removed', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const key = `footer_${Date.now()}`
    let created: BlockBody | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', BLOCKS_PATH, {
        token,
        data: { key, name: 'Shop footer', html: '<p>Shop sp. z o.o.</p>' },
      })
      expect(createResponse.status()).toBe(200)
      created = await readJsonSafe<BlockBody>(createResponse)
      expect(created?.id).toBeTruthy()
      expect(created?.updatedAt).toBeTruthy()

      const listResponse = await apiRequest(request, 'GET', `${BLOCKS_PATH}?pageSize=100`, { token })
      const list = await readJsonSafe<{ items?: BlockBody[] }>(listResponse)
      const listed = (list?.items ?? []).find((item) => item.key === key)
      expect(listed?.name).toBe('Shop footer')

      // The palette carries the keys so the campaign editor can tell an author what exists to reference.
      const paletteResponse = await apiRequest(request, 'GET', '/api/marketing_automation/palette', { token })
      const palette = await readJsonSafe<{ contentBlocks?: Array<{ key?: string }> }>(paletteResponse)
      expect((palette?.contentBlocks ?? []).map((block) => block.key)).toContain(key)

      const updateResponse = await apiRequest(request, 'PUT', `${BLOCKS_PATH}/${created!.id}`, {
        token,
        headers: { 'x-om-ext-optimistic-lock-expected-updated-at': created!.updatedAt! },
        data: { updatedAt: created!.updatedAt, name: 'Shop footer', html: '<p>Shop sp. z o.o., Kraków</p>' },
      })
      expect(updateResponse.status()).toBe(200)
      const updated = await readJsonSafe<BlockBody>(updateResponse)
      expect(updated?.html).toContain('Kraków')

      // A save built on the version we ALREADY replaced must collide rather than win.
      const staleResponse = await apiRequest(request, 'PUT', `${BLOCKS_PATH}/${created!.id}`, {
        token,
        headers: { 'x-om-ext-optimistic-lock-expected-updated-at': created!.updatedAt! },
        data: { updatedAt: created!.updatedAt, name: 'Stale', html: '<p>stale</p>' },
      })
      expect(staleResponse.status()).toBe(409)
      const conflict = await readJsonSafe<{ code?: string }>(staleResponse)
      expect(conflict?.code).toBe('optimistic_lock_conflict')

      await removeBlock(request, token, created!.id!, updated!.updatedAt!)
      created = null

      const afterDelete = await apiRequest(request, 'GET', `${BLOCKS_PATH}?pageSize=100`, { token })
      const remaining = await readJsonSafe<{ items?: BlockBody[] }>(afterDelete)
      expect((remaining?.items ?? []).some((item) => item.key === key)).toBe(false)

      // The key is free again: uniqueness covers live rows only, so a mistaken deletion does not burn a name.
      const reuseResponse = await apiRequest(request, 'POST', BLOCKS_PATH, {
        token,
        data: { key, name: 'Shop footer again', html: '<p>again</p>' },
      })
      expect(reuseResponse.status()).toBe(200)
      const reused = await readJsonSafe<BlockBody>(reuseResponse)
      if (reused?.id && reused.updatedAt) await removeBlock(request, token, reused.id, reused.updatedAt)
    } finally {
      if (created?.id && created.updatedAt) await removeBlock(request, token, created.id, created.updatedAt)
    }
  })

  test('a key already in use is refused with a code the form can show', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const key = `banner_${Date.now()}`
    let created: BlockBody | null = null

    try {
      const first = await apiRequest(request, 'POST', BLOCKS_PATH, {
        token,
        data: { key, name: 'Banner', html: '<p>banner</p>' },
      })
      expect(first.status()).toBe(200)
      created = await readJsonSafe<BlockBody>(first)

      const duplicate = await apiRequest(request, 'POST', BLOCKS_PATH, {
        token,
        data: { key, name: 'Banner copy', html: '<p>copy</p>' },
      })
      expect(duplicate.status()).toBe(409)
      const body = await readJsonSafe<{ code?: string }>(duplicate)
      expect(body?.code).toBe('marketing_automation.errors.blockKeyTaken')
    } finally {
      if (created?.id && created.updatedAt) await removeBlock(request, token, created.id, created.updatedAt)
    }
  })

  test('a key outside the allowed shape is refused before it reaches the database', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'POST', BLOCKS_PATH, {
      token,
      data: { key: 'Not A Key!', name: 'Bad', html: '<p>x</p>' },
    })
    expect(response.status()).toBe(400)
  })

  test('an anonymous caller cannot read the blocks', async ({ request }) => {
    const response = await request.get(BLOCKS_PATH)
    expect([401, 403]).toContain(response.status())
  })
})
