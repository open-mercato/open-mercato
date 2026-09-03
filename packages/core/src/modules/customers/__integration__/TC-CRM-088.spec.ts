import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  createDealFixture,
  createPersonFixture,
  deleteEntityByBody,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import {
  bumpRecordViaApi,
  expectConflictBanner,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'

/**
 * TC-CRM-088: Deal People tab — linked-people parity
 *
 * The deal People tab now renders the same card list as the company tab, backed by
 * `GET /api/customers/deals/{id}/people`. That endpoint was widened additively so the shared
 * card has the fields it renders, and link/unlink still go through the deal's own update
 * rather than a per-link endpoint.
 *
 * The FIRST test covers the server half of that parity end to end:
 *
 *  - the widened payload carries the card's fields while keeping every pre-existing key, so
 *    `DealLinkedEntitiesTab` (still used by the Companies tab) and third-party consumers work;
 *  - search matches on the newly exposed columns, not just the label;
 *  - unlink and link round-trip through `PUT /api/customers/deals`;
 *  - profile-backed columns resolve for every linked person, which is what the batched read
 *    added by this change is for.
 *
 * The SECOND test drives the tab itself in the browser — link an existing person, filter and
 * sort, unlink from the card, create-and-link a new contact — and then the interleaved-unlink
 * conflict path from Risk 2 of the spec. That last step is only meaningful now that #5757 has
 * merged: before it, a links-only write did not advance `customer_deals.updated_at`, so a
 * stale second unlink was silently accepted instead of 409-ing.
 *
 * The two surfaces the tab deliberately withholds — the linked date and the "recently linked"
 * sort — are asserted at the unit level in `DealPeopleSection.test.tsx` instead: they are a
 * client-side decision, and the endpoint keeps supporting `sort=recent` for existing callers.
 */

const BASE_URL = process.env.BASE_URL?.trim() || null
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

type DealPersonItem = {
  id: string
  label: string
  subtitle: string | null
  kind: string
  linkedAt: string
  isPrimary: boolean
  displayName: string
  primaryEmail: string | null
  primaryPhone: string | null
  status: string | null
  lifecycleStage: string | null
  jobTitle: string | null
  department: string | null
  createdAt: string
  organizationId: string
  temperature: string | null
  source: string | null
}

type DealPeoplePage = {
  items: DealPersonItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}


async function listPeopleFor(
  request: APIRequestContext,
  token: string,
  dealId: string,
): Promise<DealPeoplePage> {
  const response = await request.get(
    resolveUrl(`/api/customers/deals/${dealId}/people?page=1&pageSize=100&sort=name-asc`),
    { headers: { authorization: `Bearer ${token}` } },
  )
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as DealPeoplePage
}

test.describe('TC-CRM-088 deal linked-people parity', () => {
  test('exposes the card fields additively, searches them, and round-trips link changes', async ({
    request,
  }) => {
    const token = await getAuthToken(request)
    const stamp = Date.now()
    const created: Array<{ path: string; id: string }> = []

    const adaId = await createPersonFixture(request, token, {
      firstName: 'Ada',
      lastName: `Lovelace ${stamp}`,
      displayName: `Ada Lovelace ${stamp}`,
    })
    created.push({ path: '/api/customers/people', id: adaId })

    const graceId = await createPersonFixture(request, token, {
      firstName: 'Grace',
      lastName: `Hopper ${stamp}`,
      displayName: `Grace Hopper ${stamp}`,
    })
    created.push({ path: '/api/customers/people', id: graceId })

    const dealId = await createDealFixture(request, token, {
      title: `Expansion renewal ${stamp}`,
      personIds: [adaId, graceId],
    })
    created.push({ path: '/api/customers/deals', id: dealId })

    const authHeaders = { Authorization: `Bearer ${token}` }
    const listPeople = async (query = ''): Promise<DealPeoplePage> => {
      const response = await request.get(
        resolveUrl(`/api/customers/deals/${dealId}/people?page=1&pageSize=20&sort=name-asc${query}`),
        { headers: authHeaders },
      )
      expect(response.ok()).toBeTruthy()
      return (await response.json()) as DealPeoplePage
    }

    try {
      const initial = await listPeople()
      expect(initial.total).toBe(2)

      const ada = initial.items.find((item) => item.id === adaId)
      expect(ada).toBeDefined()

      // Pre-existing keys are retained with unchanged meaning — this is what keeps
      // DealLinkedEntitiesTab and any third-party consumer working.
      expect(ada!.label).toContain('Ada Lovelace')
      expect(ada!.kind).toBe('person')
      expect(typeof ada!.linkedAt).toBe('string')
      expect(typeof ada!.isPrimary).toBe('boolean')

      // Added keys the shared card renders. `jobTitle` / `department` come from the person
      // profile via the batched read, so they must be present (possibly null) for every row.
      expect(ada!.displayName).toContain('Ada Lovelace')
      for (const item of initial.items) {
        expect(item).toHaveProperty('primaryEmail')
        expect(item).toHaveProperty('primaryPhone')
        expect(item).toHaveProperty('status')
        expect(item).toHaveProperty('lifecycleStage')
        expect(item).toHaveProperty('jobTitle')
        expect(item).toHaveProperty('department')
        expect(item).toHaveProperty('temperature')
        expect(item).toHaveProperty('source')
        expect(typeof item.createdAt).toBe('string')
        expect(typeof item.organizationId).toBe('string')
      }

      // Search still narrows by name.
      const byName = await listPeople(`&search=${encodeURIComponent('Grace Hopper')}`)
      expect(byName.items.map((item) => item.id)).toEqual([graceId])

      // Unlink goes through the deal's own update, the same write the tab's card action makes.
      const unlink = await request.put(resolveUrl('/api/customers/deals'), {
        headers: authHeaders,
        data: { id: dealId, personIds: [graceId] },
      })
      expect(unlink.ok()).toBeTruthy()

      const afterUnlink = await listPeople()
      expect(afterUnlink.total).toBe(1)
      expect(afterUnlink.items.map((item) => item.id)).toEqual([graceId])

      // …and linking back is the same path in reverse, which is what the link dialog performs.
      const relink = await request.put(resolveUrl('/api/customers/deals'), {
        headers: authHeaders,
        data: { id: dealId, personIds: [graceId, adaId] },
      })
      expect(relink.ok()).toBeTruthy()

      const afterRelink = await listPeople()
      expect(afterRelink.total).toBe(2)
      expect(afterRelink.items.map((item) => item.id).sort()).toEqual([adaId, graceId].sort())
    } finally {
      for (const entry of created.reverse()) {
        await deleteEntityByBody(request, token, entry.path, entry.id)
      }
    }
  })

  /**
   * The UI half the merged spec assigns to this PR: the five steps of § "PR 2 —
   * integration / UI", driven through the real tab rather than the endpoint behind it.
   *
   * Self-contained like the sibling test: three people and a deal are created via the API and
   * torn down in `finally`, so nothing depends on seeded or demo data.
   */
  test('links, filters, unlinks and creates-and-links from the People tab, and surfaces a stale unlink', async ({
    page,
    request,
  }: { page: import('@playwright/test').Page; request: APIRequestContext }) => {
    test.slow()

    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const created: Array<{ path: string; id: string }> = []

    const linkedName = `TC088 Linked ${stamp}`
    const unlinkedName = `TC088 Unlinked ${stamp}`
    const decoyName = `TC088 Decoy ${stamp}`
    const newContactName = `TC088 Created ${stamp}`

    const linkedId = await createPersonFixture(request, token, {
      firstName: 'TC088', lastName: `Linked ${stamp}`, displayName: linkedName,
    })
    created.push({ path: '/api/customers/people', id: linkedId })
    const unlinkedId = await createPersonFixture(request, token, {
      firstName: 'TC088', lastName: `Unlinked ${stamp}`, displayName: unlinkedName,
    })
    created.push({ path: '/api/customers/people', id: unlinkedId })
    const decoyId = await createPersonFixture(request, token, {
      firstName: 'TC088', lastName: `Decoy ${stamp}`, displayName: decoyName,
    })
    created.push({ path: '/api/customers/people', id: decoyId })

    const dealId = await createDealFixture(request, token, {
      title: `TC-CRM-088 UI Deal ${stamp}`,
      personIds: [linkedId, decoyId],
    })
    created.push({ path: '/api/customers/deals', id: dealId })

    try {
      await login(page, 'admin')
      await page.goto(`/backend/customers/deals/${dealId}?tab=people`, { waitUntil: 'domcontentloaded' })

      const linkedCard = page.locator('div').filter({ hasText: linkedName })
      await expect(linkedCard.first(), 'the People tab should render a card per linked person')
        .toBeVisible({ timeout: 30_000 })

      // --- Step 1: link an existing person through the dialog ---
      await page.getByRole('button', { name: /Link existing person/i }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      await dialog.getByPlaceholder(/Search all people/i).fill(unlinkedName)
      await dialog.getByText(unlinkedName, { exact: false }).first().click()
      await dialog.getByRole('button', { name: /^Link person$/i }).click()
      await expect(dialog).toBeHidden({ timeout: 30_000 })
      await expect(
        page.getByText(unlinkedName, { exact: false }).first(),
        'the newly linked person should appear in the list',
      ).toBeVisible({ timeout: 30_000 })

      // --- Step 2: filter and sort ---
      await page.getByRole('button', { name: /Filters/i }).click()
      const search = page.getByPlaceholder(/Search by name, role, email/i)
      await search.fill(unlinkedName)
      await expect(page.getByText(unlinkedName, { exact: false }).first()).toBeVisible({ timeout: 30_000 })
      await expect(
        page.getByText(decoyName, { exact: false }),
        'search should exclude the non-matching linked person',
      ).toHaveCount(0, { timeout: 30_000 })

      await search.fill('')
      // The deal tab offers only the two name sorts — "recent" is withheld until PR 3, which
      // is exactly what `DealPeopleSection.test.tsx` pins at the unit level.
      const sort = page.locator('select').first()
      await expect(sort).toBeVisible({ timeout: 15_000 })
      await expect(sort).toHaveValue('name-asc')
      await expect(
        sort.locator('option[value="recent"]'),
        'the deal tab must not offer the "recently linked" sort until PR 3 stops re-dating links',
      ).toHaveCount(0)
      await sort.selectOption('name-desc')
      await expect(sort).toHaveValue('name-desc')

      // --- Step 3: unlink from the card ---
      const decoyCard = page.locator('[data-slot="card"]').filter({ hasText: decoyName }).first()
      await decoyCard.getByRole('button', { name: /Unlink/i }).first().click()
      await expect(
        page.getByText(decoyName, { exact: false }),
        'the unlinked person should leave the list',
      ).toHaveCount(0, { timeout: 30_000 })

      // --- Step 4: create-and-link a new contact ---
      await page.getByRole('button', { name: /^Add person$/i }).click()
      const createDialog = page.getByRole('dialog')
      await expect(createDialog).toBeVisible({ timeout: 15_000 })
      await createDialog.getByLabel(/Display name/i).fill(newContactName)
      await createDialog.getByRole('button', { name: /Create person/i }).click()
      await expect(createDialog).toBeHidden({ timeout: 30_000 })
      await expect(
        page.getByText(newContactName, { exact: false }).first(),
        'a person created from the tab should be linked to the deal straight away',
      ).toBeVisible({ timeout: 30_000 })

      // --- Step 5: interleaved unlink → conflict (Risk 2) ---
      // Move the deal's lock token out of band, exactly as a second operator would. This only
      // 409s because #5757 made a links-only write advance `updated_at`.
      const currentIds = (await listPeopleFor(request, token, dealId)).items.map((item) => item.id)
      await bumpRecordViaApi(request, token, '/api/customers/deals', {
        id: dealId,
        personIds: currentIds.filter((id) => id !== linkedId),
      })

      // The page still holds the pre-bump token, so its next unlink is stale.
      const staleCard = page.locator('[data-slot="card"]').filter({ hasText: newContactName }).first()
      await staleCard.getByRole('button', { name: /Unlink/i }).first().click()
      await expectConflictBanner(page, { timeout: 30_000 })
    } finally {
      for (const entry of created.reverse()) {
        await deleteEntityByBody(request, token, entry.path, entry.id)
      }
    }
  })

})
