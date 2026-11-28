import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { hashToken } from '@open-mercato/shared/lib/search/tokenize'
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
type ListSearchResponse = { items?: Array<{ id?: string }> }

const DEFAULT_STRATEGIES = ['fulltext', 'vector', 'tokens']
const PERSON_PROFILE = 'customers:customer_person_profile'
const COMPANY_PROFILE = 'customers:customer_company_profile'
// Matched as a pattern, not the full string. The rendered placeholder is
// `customers.{people,companies}.list.searchPlaceholder` — "Search by name, email, phone…" — whose
// trailing ellipsis is a single U+2026 character and whose tail is ordinary copy. TC-CRM-001, -014,
// -015, -029, -030, -033 and -065 all locate this same input with `/Search by name/i`; matching
// the stable prefix keeps this spec failing on the palette contract it guards rather than on an
// i18n copy edit.
const LIST_SEARCH_PLACEHOLDER = /Search by name/i

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
 * Waits until global search has indexed the customer's profile row for `title`.
 *
 * The wait exists for one reason only: to keep the browser assertions below from racing the
 * indexer. A palette that renders zero rows because indexing has not caught up is
 * indistinguishable, at the DOM level, from a palette that correctly renders one.
 *
 * It therefore polls for the PRESENCE of the expected profile and never for a row count.
 * Requiring exactly one match here would be the palette's own assertion moved to the API — and
 * moved in front of the browser, where it short-circuits the run: on a pre-#5073 build the
 * global-search API returns two rows for the title, so a count-based poll would spin for its
 * full timeout and fail here, before `login()` and before the palette was ever opened. The
 * duplicate has to flow through to the DOM `toHaveCount(1)`, which is precisely what this spec
 * adds over the API-level TC-SEARCH-006.
 */
async function waitForIndexedProfile(
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
        if (!matches.some((match) => match.entityId === expectedEntityId)) {
          return `awaiting ${expectedEntityId} (titles matched: ${matches.length})`
        }
        return 'ready'
      },
      { timeout: 30_000 },
    )
    .toBe('ready')
}

/**
 * Fixture setup and list-index readiness checks use `admin`. The palette and browser list
 * searches run as `superadmin`.
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
 *      (`packages/shared/src/lib/search/entityAccess.ts:90` — note that the `packages/search`
 *      `lib/entity-access.ts` path, which #5547 cites, is a six-line re-export shim, so the
 *      reasoning below is only readable at the shared implementation) returns the caller's
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
        await waitForIndexedProfile(request, superToken, fixture.title, fixture.entityId)
      }

      await login(page, 'superadmin')

      for (const fixture of fixtures) {
        await page.goto('/backend')
        await page.waitForLoadState('domcontentloaded')
        await openPaletteWithQuery(page, fixture.title)

        const panel = page.locator('#topbar-search-results')
        await expect(panel).toBeVisible()

        // -- The duplicate guard, and the reason it counts EVERY option rather than only the
        //    ones whose text matches the title. Pre-#5073 a superadmin saw two rows here: the
        //    person/company profile plus a navigation-less `customers:customer_entity` row.
        //    Filtering by `hasText: title` first would make the assertion depend on the
        //    duplicate carrying the same title — true today, because `customer_entity`
        //    registers no `formatResult` and the fallback resolver picks `display_name`, but
        //    not a property this spec controls. Since the query is a `Date.now()`-stamped
        //    token that matches nothing else in the tenant, the honest assertion is that the
        //    palette holds exactly one row, whatever it is titled. `role="option"` is rendered
        //    once per result and nowhere else in the listbox (`TopbarSearchInline.tsx`), so
        //    the count is exactly the result rows.
        //
        //    The palette also debounces by 220ms and renders a "no results" placeholder until
        //    the response lands, so this waits for the row rather than asserting on an empty
        //    list.
        const options = panel.getByRole('option')
        await expect(options).toHaveCount(1, { timeout: 20_000 })

        const option = options.first()
        await expect(
          option,
          `the single ${fixture.label} row must be the seeded customer, not an unrelated result`,
        ).toContainText(fixture.title)
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
   * Both lists can match through profile tokens. The People arm searches by `next_interaction_name`
   * and checks the matching base `customers:customer_entity` token that #5073 preserved. Profile
   * documents include the interaction name in `search_text`, so a browser match alone can pass
   * with the base rows missing. See #5740.
   */
  test('the People and Companies list search still finds the customer', async ({ page, request }) => {
    test.setTimeout(180_000)

    const stamp = Date.now()
    const personName = `QASRCH014LP${stamp}`
    const companyName = `QASRCH014LC${stamp}`
    const nextInteractionName = `QASRCH014Next${stamp}`
    let cleanupToken: string | null = null
    let personId: string | null = null
    let companyId: string | null = null

    try {
      const { adminToken } = await resolveTokens(request)
      cleanupToken = adminToken

      personId = await createPersonFixture(request, adminToken, {
        firstName: 'QA',
        lastName: `Search 014 List ${stamp}`,
        displayName: personName,
        nextInteractionName,
      })
      companyId = await createCompanyFixture(request, adminToken, companyName)

      const listArms = [
        {
          label: 'People by display name',
          path: '/backend/customers/people',
          endpoint: '/api/customers/people',
          query: personName,
          title: personName,
          id: personId,
        },
        {
          label: 'Companies by display name',
          path: '/backend/customers/companies',
          endpoint: '/api/customers/companies',
          query: companyName,
          title: companyName,
          id: companyId,
        },
        {
          label: 'People by next interaction name',
          path: '/backend/customers/people',
          endpoint: '/api/customers/people',
          query: nextInteractionName,
          title: personName,
          id: personId,
        },
      ]

      for (const arm of listArms) {
        let attempt = 0
        await expect
          .poll(async () => {
            attempt += 1
            const params = new URLSearchParams({ search: arm.query, qaAttempt: String(attempt) })
            const response = await apiRequest(request, 'GET', `${arm.endpoint}?${params}`, { token: adminToken })
            const body = await readJsonSafe<ListSearchResponse>(response)
            return body?.items?.map((item) => item.id) ?? []
          }, { message: `Wait for ${arm.label} to be indexed`, timeout: 30_000 })
          .toContain(arm.id)
      }

      await login(page, 'superadmin')

      for (const arm of listArms) {
        await test.step(arm.label, async () => {
          await page.goto(arm.path)
          const searchBox = page.getByPlaceholder(LIST_SEARCH_PLACEHOLDER)
          await expect(searchBox).toBeVisible()

          const [response] = await Promise.all([
            page.waitForResponse(
              (response) => {
                const url = new URL(response.url())
                return url.pathname === arm.endpoint && url.searchParams.get('search') === arm.query
              },
              { timeout: 30_000 },
            ),
            searchBox.fill(arm.query),
          ])

          expect(response.status(), `${arm.label} should return HTTP 200`).toBe(200)
          const body = await response.json() as ListSearchResponse
          expect(body.items?.map((item) => item.id), `${arm.label} should return the fixture`).toContain(arm.id)
          await expect(page.getByText(arm.title, { exact: true }).first()).toBeVisible({ timeout: 20_000 })

          if (arm.query === nextInteractionName) {
            const { tenantId, organizationId } = getTokenContext(adminToken)
            const tokenHash = hashToken(nextInteractionName.toLowerCase())
            await withClient(async (client) => {
              await expect
                .poll(async () => {
                  const result = await client.query(
                    `select 1 from search_tokens
                     where entity_type = 'customers:customer_entity' and entity_id = $1
                       and tenant_id = $2 and organization_id = $3
                       and field = 'next_interaction_name' and token_hash = $4`,
                    [arm.id, tenantId, organizationId, tokenHash],
                  )
                  return result.rowCount
                }, { message: 'The fixture must have a base customer token for its next interaction name' })
                .toBe(1)
            })
          }
        })
      }
    } finally {
      await deleteEntityIfExists(request, cleanupToken, '/api/customers/people', personId)
      await deleteEntityIfExists(request, cleanupToken, '/api/customers/companies', companyId)
    }
  })
})
