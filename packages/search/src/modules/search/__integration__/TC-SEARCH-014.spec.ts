import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

export const integrationMeta = { dependsOnModules: ['search', 'customers'] }

type GlobalSearchSettings = { enabledStrategies?: string[] }
type SearchResultItem = {
  entityId?: string
  recordId?: string
  presenter?: { title?: string } | null
  url?: string | null
}
type GlobalSearchResponse = { results?: SearchResultItem[] }

const DEFAULT_STRATEGIES = ['fulltext', 'vector', 'tokens']
const PERSON_PROFILE = 'customers:customer_person_profile'
const COMPANY_PROFILE = 'customers:customer_company_profile'
const LIST_SEARCH_PLACEHOLDER = 'Search by name, email, phone…'

type Fixture = {
  label: 'person' | 'company'
  title: string
  entityId: string
  detailPrefix: string
  listPath: string
}

function presenterTitle(result: SearchResultItem): string | null {
  const title = result.presenter?.title
  return typeof title === 'string' && title.trim().length > 0 ? title.trim() : null
}

async function readEnabledStrategies(request: APIRequestContext, token: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', '/api/search/settings/global-search', { token })
  expect(response.ok(), 'GET global-search settings should succeed').toBeTruthy()
  const body = (await readJsonSafe<GlobalSearchSettings>(response)) ?? {}
  return Array.isArray(body.enabledStrategies) && body.enabledStrategies.length > 0
    ? body.enabledStrategies
    : DEFAULT_STRATEGIES
}

async function writeEnabledStrategies(
  request: APIRequestContext,
  token: string,
  strategies: string[],
): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/search/settings/global-search', {
    token,
    data: { enabledStrategies: strategies },
  })
  expect(response.status(), 'POST global-search settings should return 200').toBe(200)
}

/**
 * Waits until global search returns exactly one result for `title` and that result is the
 * customer's profile row. Polling the API first keeps the browser assertions below from
 * racing the indexer — a palette that renders zero rows because indexing has not caught up
 * is indistinguishable, at the DOM level, from a palette that correctly renders one.
 */
async function waitForSingleIndexedProfile(
  request: APIRequestContext,
  token: string,
  title: string,
  expectedEntityId: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const params = new URLSearchParams({ q: title, limit: '20' })
        const response = await apiRequest(
          request,
          'GET',
          `/api/search/search/global?${params.toString()}`,
          { token },
        )
        if (!response.ok()) return `status:${response.status()}`
        const body = (await readJsonSafe<GlobalSearchResponse>(response)) ?? {}
        const results = Array.isArray(body.results) ? body.results : []
        const matches = results.filter((result) => presenterTitle(result) === title)
        if (matches.length !== 1) return `matches:${matches.length}`
        if (matches[0]?.entityId !== expectedEntityId) return `entity:${matches[0]?.entityId ?? 'missing'}`
        return 'ready'
      },
      { timeout: 30_000 },
    )
    .toBe('ready')
}

/**
 * Fixtures are seeded with the `admin` token, never the `superadmin` one, even though every
 * search-side operation below runs as `superadmin`.
 *
 * `withScopedPayload` (`packages/shared/src/lib/api/scoped.ts`) rejects a create with
 * `400 organizationRequired` unless an organization resolves from
 * `payload.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId`. A superadmin is
 * tenant-wide with `orgId: null`, so seeding an org-scoped customer with its token is a
 * guaranteed 400 — the same split TC-CRM-084 uses, where `superadmin` does tenant-level work
 * and `admin` creates the org-scoped records.
 *
 * Both accounts are seeded into the same tenant, which is what makes the split safe: the
 * superadmin's tenant-wide search still sees the admin's records. That assumption is asserted
 * rather than trusted, so a seeding change fails here with a clear message instead of
 * surfacing later as an inexplicably empty palette.
 */
async function resolveTokens(
  request: APIRequestContext,
): Promise<{ adminToken: string; superToken: string }> {
  const adminToken = await getAuthToken(request, 'admin')
  const superToken = await getAuthToken(request, 'superadmin')
  const adminTenant = getTokenContext(adminToken).tenantId
  const superTenant = getTokenContext(superToken).tenantId
  expect(adminTenant.length, 'the admin token carries a tenant id').toBeGreaterThan(0)
  expect(
    superTenant,
    'admin and superadmin must share a tenant, or the superadmin palette cannot see the seeded customers',
  ).toBe(adminTenant)
  return { adminToken, superToken }
}

async function openPaletteWithQuery(page: Page, query: string): Promise<void> {
  await page.locator('header').getByRole('button', { name: 'Open global search' }).click()
  const input = page.locator('[data-search-expanded="true"] input[type="text"]')
  await expect(input).toBeVisible()
  await input.fill(query)
}

/**
 * TC-SEARCH-014: a customer appears exactly ONCE in the ⌘K palette, as a navigable row.
 * Source: issue #5547, the browser-level follow-up to #5073 (fixes #5046).
 *
 * #5073 shipped TC-SEARCH-006, which asserts the same contract against the JSON of
 * `GET /api/search/search{,/global}`. That is the right level for the strategy/entity-type
 * contract, but it cannot see the thing the original report describes: two rows in the
 * palette, one greyed out and unclickable. `TopbarSearchInline.tsx` renders a result with no
 * primary link at `opacity-60` with muted text and makes `openResult` a no-op for it, and it
 * is that rendering — not the response shape — that made the duplicate look like a broken
 * search result rather than an extra API row.
 *
 * Two things make this spec load-bearing rather than a duplicate of TC-SEARCH-006:
 *
 *   1. It asserts the `role="option"` COUNT. A `toBeVisible()` on the profile row passes even
 *      when the duplicate sits next to it, which is precisely the failure mode being guarded.
 *      The count also stays honest if a future strategy, enricher or injected result
 *      re-introduces a second row by some path other than the token strategy.
 *   2. It signs in as `superadmin`, and that is essential. `resolveReadableEntityTypes`
 *      (`packages/search/src/modules/search/lib/entity-access.ts`) returns the caller's
 *      requested entity types unchanged for a superadmin and narrows every other principal to
 *      entity types a module registered in its `search.ts`. No module registers
 *      `customers:customer_entity`, so the duplicate was only ever visible to a superadmin —
 *      the same test written as `admin` passes on the broken build too.
 *
 * Strategies are pinned to `tokens` (and restored in `finally`) so the run needs neither
 * Meilisearch nor an embedding provider, and because the duplicate is a token-strategy
 * artifact in the first place. `workers: 1` in the shared Playwright config keeps that
 * tenant-scoped settings write from colliding with a concurrent spec.
 */
test.describe('TC-SEARCH-014: a customer appears once in the global search palette', () => {
  test('the palette renders exactly one navigable row per customer', async ({ page, request }) => {
    test.slow()
    test.setTimeout(180_000)

    const stamp = Date.now()
    const personName = `QASRCH014P${stamp}`
    const companyName = `QASRCH014C${stamp}`
    let adminToken: string | null = null
    let superToken: string | null = null
    let originalStrategies: string[] | null = null
    let personId: string | null = null
    let companyId: string | null = null

    try {
      const tokens = await resolveTokens(request)
      adminToken = tokens.adminToken
      superToken = tokens.superToken

      originalStrategies = await readEnabledStrategies(request, superToken)
      await writeEnabledStrategies(request, superToken, ['tokens'])

      personId = await createPersonFixture(request, adminToken, {
        firstName: 'QA',
        lastName: `Search 014 ${stamp}`,
        displayName: personName,
      })
      companyId = await createCompanyFixture(request, adminToken, companyName)

      const fixtures: Fixture[] = [
        {
          label: 'person',
          title: personName,
          entityId: PERSON_PROFILE,
          detailPrefix: '/backend/customers/people-v2',
          listPath: '/backend/customers/people',
        },
        {
          label: 'company',
          title: companyName,
          entityId: COMPANY_PROFILE,
          detailPrefix: '/backend/customers/companies-v2',
          listPath: '/backend/customers/companies',
        },
      ]

      // Poll as `superadmin` — the same principal the palette queries as — so an entity-access
      // difference between the two accounts surfaces here rather than as an empty palette.
      for (const fixture of fixtures) {
        await waitForSingleIndexedProfile(request, superToken, fixture.title, fixture.entityId)
      }

      await login(page, 'superadmin')

      for (const fixture of fixtures) {
        await page.goto('/backend')
        await page.waitForLoadState('domcontentloaded')
        await openPaletteWithQuery(page, fixture.title)

        const panel = page.locator('#topbar-search-results')
        await expect(panel).toBeVisible()

        // The palette debounces by 220ms and renders a "no results" placeholder until the
        // response lands, so wait for the row itself rather than asserting on an empty list.
        const matchingOptions = panel.getByRole('option').filter({ hasText: fixture.title })
        await expect(matchingOptions).toHaveCount(1, { timeout: 20_000 })

        // -- The duplicate guard. Pre-#5073 this was 2 for a superadmin: the person/company
        //    profile row plus a navigation-less `customers:customer_entity` row.
        const option = matchingOptions.first()
        const optionClass = (await option.getAttribute('class')) ?? ''
        expect(
          optionClass,
          `the ${fixture.label} row must have a primary link — 'opacity-60' marks the greyed-out, unclickable duplicate`,
        ).not.toContain('opacity-60')

        // -- The row navigates. `openResult` is a no-op when the result has no primary link,
        //    so a duplicate row would leave the URL on /backend.
        await option.click()
        await page.waitForURL(new RegExp(`${fixture.detailPrefix}/[^/?#]+$`), { timeout: 20_000 })
      }
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
      if (superToken && originalStrategies) {
        await writeEnabledStrategies(request, superToken, originalStrategies).catch(() => undefined)
      }
    }
  })

  /**
   * Regression arm for the deliberate read-side-only decision behind #5073: the base
   * `customers:customer_entity` rows must STAY in `search_tokens`, because
   * `findEntityIdsBySearchTokens` — which backs the People/Companies list search — resolves
   * ids through them. A future "cleanup" that drops those rows write-side fails here instead
   * of silently breaking list search.
   */
  test('the People and Companies list search still finds the customer', async ({ page, request }) => {
    test.slow()
    test.setTimeout(180_000)

    const stamp = Date.now()
    const personName = `QASRCH014LP${stamp}`
    const companyName = `QASRCH014LC${stamp}`
    let adminToken: string | null = null
    let personId: string | null = null
    let companyId: string | null = null

    try {
      adminToken = (await resolveTokens(request)).adminToken

      personId = await createPersonFixture(request, adminToken, {
        firstName: 'QA',
        lastName: `Search 014 List ${stamp}`,
        displayName: personName,
      })
      companyId = await createCompanyFixture(request, adminToken, companyName)

      await login(page, 'superadmin')

      const listArms = [
        { label: 'people', path: '/backend/customers/people', endpoint: '/api/customers/people', title: personName },
        {
          label: 'companies',
          path: '/backend/customers/companies',
          endpoint: '/api/customers/companies',
          title: companyName,
        },
      ] as const

      for (const arm of listArms) {
        await page.goto(arm.path)
        await page.waitForLoadState('domcontentloaded')

        const searchBox = page.getByPlaceholder(LIST_SEARCH_PLACEHOLDER)
        await expect(searchBox).toBeVisible()

        // Wait for the FILTERED response specifically. Asserting only that the row is
        // visible after typing would be a false guard: a freshly created customer can
        // already sit on the unfiltered first page, so the assertion would pass even if
        // list search resolved no ids at all — the exact regression this arm exists to
        // catch. Keying the wait on `search=<token>` proves the query really ran.
        const filteredResponse = page.waitForResponse(
          (response) => {
            const url = new URL(response.url())
            return (
              url.pathname === arm.endpoint &&
              url.searchParams.get('search') === arm.title &&
              response.status() === 200
            )
          },
          { timeout: 30_000 },
        )
        await searchBox.fill(arm.title)
        await filteredResponse

        await expect(
          page.getByText(arm.title, { exact: true }).first(),
          `${arm.label} list search must still resolve ids through the base customer search tokens`,
        ).toBeVisible({ timeout: 20_000 })
      }
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
    }
  })
})
