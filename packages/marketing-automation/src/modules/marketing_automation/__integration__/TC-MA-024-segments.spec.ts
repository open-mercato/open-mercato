import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

const SEGMENTS_PATH = '/api/marketing_automation/segments'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

type SegmentBody = { id?: string; slug?: string; name?: string; updatedAt?: string; expression?: unknown }

async function removeSegment(request: Parameters<typeof apiRequest>[0], token: string, id: string, updatedAt: string) {
  await apiRequest(request, 'DELETE', `${SEGMENTS_PATH}/${id}`, { token, headers: { [LOCK_HEADER]: updatedAt } })
}

/**
 * TC-MA-024: saved segments.
 *
 * The assertions that matter: a slug is derived and then immutable, a segment cannot be defined in terms of
 * segments, membership is resolved by the same matcher the dispatcher uses, and the answer says whether it is
 * exact or a sample.
 */
test.describe('TC-MA-024 segments', () => {
  test('a segment is created with a derived reference, edited, and removed', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let segment: SegmentBody | null = null

    try {
      const created = await apiRequest(request, 'POST', SEGMENTS_PATH, {
        token,
        data: {
          name: `TC MA 024 Buyers ${Date.now()}`,
          description: 'Customers with at least one order',
          expression: { operator: 'AND', rules: [{ field: 'orders.count', operator: '>=', value: 1 }] },
        },
      })
      expect(created.status()).toBe(200)
      segment = await readJsonSafe<SegmentBody>(created)
      expect(segment?.slug).toMatch(/^tc-ma-024-buyers/)

      const renamed = await apiRequest(request, 'PUT', `${SEGMENTS_PATH}/${segment!.id}`, {
        token,
        headers: { [LOCK_HEADER]: segment!.updatedAt! },
        data: { updatedAt: segment!.updatedAt, name: 'Renamed buyers' },
      })
      expect(renamed.status()).toBe(200)
      const afterRename = await readJsonSafe<SegmentBody>(renamed)
      // The reference does NOT follow the name: saved audiences point at it.
      expect(afterRename?.slug).toBe(segment?.slug)
      expect(afterRename?.name).toBe('Renamed buyers')

      // A stale save collides rather than winning.
      const stale = await apiRequest(request, 'PUT', `${SEGMENTS_PATH}/${segment!.id}`, {
        token,
        headers: { [LOCK_HEADER]: segment!.updatedAt! },
        data: { updatedAt: segment!.updatedAt, name: 'Stale' },
      })
      expect(stale.status()).toBe(409)

      await removeSegment(request, token, segment!.id!, afterRename!.updatedAt!)
      segment = null

      const listed = await readJsonSafe<{ items?: SegmentBody[] }>(
        await apiRequest(request, 'GET', `${SEGMENTS_PATH}?pageSize=100`, { token }),
      )
      expect((listed?.items ?? []).some((item) => item.slug === afterRename?.slug)).toBe(false)
    } finally {
      if (segment?.id && segment.updatedAt) await removeSegment(request, token, segment.id, segment.updatedAt)
    }
  })

  test('a segment defined in terms of segments is refused', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'POST', SEGMENTS_PATH, {
      token,
      data: {
        name: `TC MA 024 nested ${Date.now()}`,
        expression: { operator: 'AND', rules: [{ field: 'segments', operator: 'CONTAINS', value: 'anything' }] },
      },
    })
    expect(response.status()).toBe(400)
    expect((await readJsonSafe<{ code?: string }>(response))?.code).toBe('marketing_automation.errors.segmentSelfReference')
  })

  test('members are resolved by the same matcher the dispatcher uses, and the answer says what it is', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const customerId = await createPersonFixture(request, token, {
      firstName: 'Segment',
      lastName: `Member${stamp}`,
      displayName: `Segment Member ${stamp}`,
      primaryEmail: `qa-ma-seg-${stamp}@example.com`,
    })
    let segment: SegmentBody | null = null

    try {
      // A segment with no expression means everybody, which makes the membership assertion independent of
      // whatever data this installation happens to hold.
      const created = await apiRequest(request, 'POST', SEGMENTS_PATH, {
        token,
        data: { name: `TC MA 024 everybody ${stamp}`, expression: null },
      })
      expect(created.status()).toBe(200)
      segment = await readJsonSafe<SegmentBody>(created)

      const members = await apiRequest(request, 'GET', `${SEGMENTS_PATH}/${segment!.id}/members`, { token })
      expect(members.status()).toBe(200)
      const body = await readJsonSafe<{
        items?: Array<{ id?: string }>
        qualifier?: string
        checked?: number
      }>(members)
      expect((body?.items ?? []).length).toBeGreaterThan(0)
      expect(['exact', 'sample']).toContain(body?.qualifier)
      expect(body?.checked).toBeGreaterThan(0)

      const profile = await readJsonSafe<{ segments?: string[] }>(
        await apiRequest(request, 'GET', `/api/marketing_automation/customers/${customerId}/profile`, { token }),
      )
      // The profile reads membership from the same definitions, so the customer is in it.
      expect(profile?.segments ?? []).toContain(`TC MA 024 everybody ${stamp}`)
    } finally {
      if (segment?.id && segment.updatedAt) await removeSegment(request, token, segment.id, segment.updatedAt)
      await deleteEntityIfExists(request, token, '/api/customers/people', customerId)
    }
  })

  test('the palette offers saved segments so an author can target one', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let segment: SegmentBody | null = null
    try {
      segment = await readJsonSafe<SegmentBody>(
        await apiRequest(request, 'POST', SEGMENTS_PATH, {
          token,
          data: { name: `TC MA 024 palette ${Date.now()}`, expression: null },
        }),
      )
      const palette = await readJsonSafe<{ segments?: Array<{ slug?: string }> }>(
        await apiRequest(request, 'GET', '/api/marketing_automation/palette', { token }),
      )
      expect((palette?.segments ?? []).map((item) => item.slug)).toContain(segment?.slug)
    } finally {
      if (segment?.id && segment.updatedAt) await removeSegment(request, token, segment.id, segment.updatedAt)
    }
  })

  test('an anonymous caller cannot read or write segments', async ({ request }) => {
    expect([401, 403]).toContain((await request.get(SEGMENTS_PATH)).status())
    expect([401, 403]).toContain((await request.post(SEGMENTS_PATH, { data: { name: 'nope' } })).status())
  })
})
