import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createFormFixture,
  deleteFormIfExists,
  uniqueFormKey,
} from '@open-mercato/core/helpers/integration/formsFixtures'

type ListBody = {
  items?: Array<{ id: string; key: string; name: string; status: string }>
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
}

/**
 * TC-FORMS-CRUD-002: the list route is paginated, searchable, status-filtered
 * and rejects an over-cap `pageSize`.
 *
 * The `pageSize=101` probe asserts "4xx and not 500" rather than a literal 400.
 * `formListQuerySchema.pageSize` is `.max(100)`, and `handleRouteError` maps the
 * resulting `ZodError` to `400 forms.errors.invalid_payload` — but pinning 500
 * would pin the bug this route used to have, and pinning 400 exactly would
 * couple the spec to the chosen error shape. The load-bearing claim is that a
 * malformed query is the caller's fault, never a server fault.
 */
test.describe('TC-FORMS-CRUD-002: form list pagination, search and caps', () => {
  test('paginates, filters by status and search, and refuses pageSize above 100', async ({ request }) => {
    const marker = uniqueFormKey('qa_crud002')
    let adminToken: string | null = null
    const formIds: string[] = []

    try {
      adminToken = await getAuthToken(request, 'admin')

      const draftA = await createFormFixture(request, adminToken, {
        key: `${marker}_a`,
        name: `QA CRUD002 ${marker} Alpha`,
      })
      formIds.push(draftA.id)
      const draftB = await createFormFixture(request, adminToken, {
        key: `${marker}_b`,
        name: `QA CRUD002 ${marker} Beta`,
      })
      formIds.push(draftB.id)
      const archived = await createFormFixture(request, adminToken, {
        key: `${marker}_c`,
        name: `QA CRUD002 ${marker} Gamma`,
      })
      formIds.push(archived.id)

      const archiveRes = await apiRequest(request, 'DELETE', `/api/forms/${archived.id}`, { token: adminToken })
      expect(archiveRes.status(), 'archiving the third form should succeed').toBe(200)

      const defaultRes = await apiRequest(request, 'GET', '/api/forms', { token: adminToken })
      expect(defaultRes.status(), 'default list should return 200').toBe(200)
      const defaults = await readJsonSafe<ListBody>(defaultRes)
      expect(defaults?.page, 'page defaults to 1').toBe(1)
      expect(defaults?.pageSize, 'pageSize defaults to 20').toBe(20)
      expect(typeof defaults?.total === 'number' && defaults.total >= 3, 'total counts our three forms').toBe(true)
      expect(
        defaults?.totalPages,
        'totalPages is derived from total and pageSize',
      ).toBe(Math.ceil((defaults?.total ?? 0) / 20))

      // `q` matches on name OR key; the marker is unique to this run.
      const searchRes = await apiRequest(
        request,
        'GET',
        `/api/forms?q=${encodeURIComponent(marker)}&pageSize=100`,
        { token: adminToken },
      )
      expect(searchRes.status(), 'search should return 200').toBe(200)
      const searched = await readJsonSafe<ListBody>(searchRes)
      const searchedIds = (searched?.items ?? []).map((item) => item.id).sort()
      expect(searchedIds, 'search returns exactly the three marked forms').toEqual([...formIds].sort())

      const draftOnlyRes = await apiRequest(
        request,
        'GET',
        `/api/forms?q=${encodeURIComponent(marker)}&status=draft&pageSize=100`,
        { token: adminToken },
      )
      expect(draftOnlyRes.status(), 'status-filtered list should return 200').toBe(200)
      const draftOnly = await readJsonSafe<ListBody>(draftOnlyRes)
      const draftIds = (draftOnly?.items ?? []).map((item) => item.id).sort()
      expect(draftIds, 'the archived form is excluded by status=draft').toEqual([draftA.id, draftB.id].sort())
      for (const item of draftOnly?.items ?? []) {
        expect(item.status, 'every returned row matches the requested status').toBe('draft')
      }

      const pagedRes = await apiRequest(
        request,
        'GET',
        `/api/forms?q=${encodeURIComponent(marker)}&pageSize=1&page=2`,
        { token: adminToken },
      )
      expect(pagedRes.status(), 'paged list should return 200').toBe(200)
      const paged = await readJsonSafe<ListBody>(pagedRes)
      expect(paged?.pageSize, 'pageSize echoes the request').toBe(1)
      expect(paged?.page, 'page echoes the request').toBe(2)
      expect(paged?.items?.length, 'page 2 of size 1 holds one row').toBe(1)
      expect(paged?.total, 'total is the unpaged count').toBe(3)
      expect(paged?.totalPages, 'totalPages reflects the page size').toBe(3)

      const overCapRes = await apiRequest(request, 'GET', '/api/forms?pageSize=101', { token: adminToken })
      expect(
        overCapRes.status(),
        `pageSize=101 must be a client error, never a server fault (got ${overCapRes.status()})`,
      ).toBeGreaterThanOrEqual(400)
      expect(overCapRes.status(), 'pageSize=101 must not be a 5xx').toBeLessThan(500)
    } finally {
      for (const id of formIds) {
        await deleteFormIfExists(request, adminToken, id)
      }
    }
  })
})
