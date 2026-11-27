import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  cleanupOmnibusTenantActor,
  cleanupRestrictedUser,
  cleanupSecondOrganizationActor,
  createOmnibusProductFixture,
  createOmnibusTenantActor,
  createRestrictedUser,
  createSecondOrganizationActor,
  uniqueStamp,
  type OmnibusTenantActor,
} from './omnibusHelpers'

/**
 * Inserts a pending category suggestion directly via SQL (bypassing the decision
 * model) for a product that already exists in the given tenant/organization.
 * Mirrors the raw-`pg` fixture pattern already used by `TC-CAT-UNDO-002` and
 * `omnibusHelpers.insertPriceHistoryRows` for data this harness cannot create
 * through the live API (no decision model is configured in this CI job).
 */
async function insertPendingSuggestion(input: {
  productId: string
  tenantId: string
  organizationId: string
}): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into catalog_product_category_suggestions
         (id, product_id, organization_id, tenant_id, outcome, status, trigger, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, $3, 'no_match', 'pending', 'manual', now(), now())
       returning id`,
      [input.productId, input.organizationId, input.tenantId],
    )
    return result.rows[0].id
  })
}

async function deleteSuggestionIfExists(suggestionId: string | null): Promise<void> {
  if (!suggestionId) return
  await withClient(async (client) => {
    await client.query('delete from catalog_product_category_suggestions where id = $1', [suggestionId])
  }).catch(() => undefined)
}

/**
 * TC-CAT-051: catalog AI categorization — ACL denial and cross-tenant isolation.
 *
 * Deliberately lives outside `__integration__/ai-categorization/`: that folder's
 * `meta.ts` requires `OM_DECISION_PROVIDER`/`OM_DECISION_MODEL`/`OM_DECISION_FIXTURE_ENABLED`
 * (see `.ai/specs/2026-10-28-catalog-ai-product-categorization.md` and the
 * implementation PR's "Decision needed" note), which CI's integration job does not
 * set — the whole folder is skipped there, so none of these boundaries have ever run
 * in CI. These checks are pure ACL/scope gates that fire before any decision-model
 * call, so none of them need the fixture provider — this file runs unconditionally.
 */

const SETTINGS_PATH = '/api/catalog/ai-categorization/settings'
const SUGGESTIONS_PATH = '/api/catalog/category-suggestions'
const BULK_PATH = '/api/catalog/ai-categorization/bulk'

test.describe('TC-CAT-051: catalog AI categorization ACL denial and tenant isolation', () => {
  test('catalog.ai_categorization.use denial: suggest, accept, reject, bulk and list all answer 403', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const stamp = uniqueStamp()
    let actor: OmnibusTenantActor | null = null
    let restricted: { roleId: string; userId: string; token: string } | null = null
    try {
      actor = await createOmnibusTenantActor(request, superadminToken, stamp, ['catalog.products.manage', 'catalog.settings.manage'])
      restricted = await createRestrictedUser(request, superadminToken, actor, stamp, ['catalog.products.manage'])
      const probeId = randomUUID()

      const suggest = await apiRequest(request, 'POST', `/api/catalog/products/${probeId}/category-suggestion`, {
        token: restricted.token,
        data: {},
      })
      expect(suggest.status(), 'suggest requires catalog.ai_categorization.use').toBe(403)

      const accept = await apiRequest(request, 'POST', `${SUGGESTIONS_PATH}/${probeId}/accept`, {
        token: restricted.token,
        data: {},
      })
      expect(accept.status(), 'accept requires catalog.ai_categorization.use').toBe(403)

      const reject = await apiRequest(request, 'POST', `${SUGGESTIONS_PATH}/${probeId}/reject`, {
        token: restricted.token,
        data: {},
      })
      expect(reject.status(), 'reject requires catalog.ai_categorization.use').toBe(403)

      const bulk = await apiRequest(request, 'POST', BULK_PATH, {
        token: restricted.token,
        data: { productIds: [probeId], scope: 'selected' },
      })
      expect(bulk.status(), 'bulk requires catalog.ai_categorization.use').toBe(403)

      const list = await apiRequest(request, 'GET', `${SUGGESTIONS_PATH}?pageSize=10`, { token: restricted.token })
      expect(list.status(), 'the suggestions list requires catalog.ai_categorization.use').toBe(403)
    } finally {
      await cleanupRestrictedUser(request, superadminToken, restricted)
      await cleanupOmnibusTenantActor(request, superadminToken, actor)
    }
  })

  test('catalog.settings.manage denial: the settings PUT answers 403 while GET stays allowed', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const stamp = uniqueStamp()
    let actor: OmnibusTenantActor | null = null
    let restricted: { roleId: string; userId: string; token: string } | null = null
    try {
      actor = await createOmnibusTenantActor(request, superadminToken, stamp, ['catalog.products.manage'])
      restricted = await createRestrictedUser(request, superadminToken, actor, stamp, ['catalog.products.view'])

      const put = await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token: restricted.token,
        data: { settings: { enabled: false, applyMode: 'suggest', autoApplyThreshold: 0.85, autoSuggestOnCreate: false } },
      })
      expect(put.status(), 'settings PUT requires catalog.settings.manage').toBe(403)

      const get = await apiRequest(request, 'GET', SETTINGS_PATH, { token: restricted.token })
      expect(get.status(), 'settings GET only requires catalog.products.view').toBe(200)
    } finally {
      await cleanupRestrictedUser(request, superadminToken, restricted)
      await cleanupOmnibusTenantActor(request, superadminToken, actor)
    }
  })

  test('a foreign tenant or a foreign organization cannot read a real home-tenant category suggestion', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const stamp = uniqueStamp()
    const features = ['catalog.ai_categorization.use', 'catalog.products.manage', 'catalog.settings.manage']
    let home: OmnibusTenantActor | null = null
    let foreignTenant: OmnibusTenantActor | null = null
    let foreignOrg: { organizationId: string; roleId: string; userId: string; token: string } | null = null
    let suggestionId: string | null = null
    try {
      home = await createOmnibusTenantActor(request, superadminToken, stamp, features)
      foreignTenant = await createOmnibusTenantActor(request, superadminToken, `${stamp}-foreign`, features)
      foreignOrg = await createSecondOrganizationActor(request, superadminToken, home, stamp, features)

      // A real suggestion, for a real home-tenant product — not a random probe id.
      // An empty result for a nonexistent id would pass even if the list's
      // tenant/organization filter were removed entirely; only a genuine row
      // that the home actor CAN read, and foreign actors provably CANNOT, proves
      // the scoping actually runs. Inserted directly (no decision model is
      // configured in this CI job) via `insertPendingSuggestion`.
      //
      // accept/reject are not exercised here: both gate on
      // `categorizationService.getStatus({ tenantId }).effective` before any
      // suggestion lookup, and in an environment with no decision model
      // configured (this CI job's integration env included) that gate is
      // closed for every tenant — home or foreign — so they always answer
      // 409 `ai_categorization_unavailable` regardless of tenant or org, which
      // would prove nothing about isolation specifically. Their ACL-level
      // scoping (not row-level) is covered by the dedicated ACL denial tests
      // in this file instead.
      const productId = await createOmnibusProductFixture(request, home.token, stamp)
      suggestionId = await insertPendingSuggestion({
        productId,
        tenantId: home.tenantId,
        organizationId: home.organizationId,
      })

      const homeList = await apiRequest(request, 'GET', `${SUGGESTIONS_PATH}?ids=${encodeURIComponent(suggestionId)}`, {
        token: home.token,
      })
      expect(homeList.status(), 'the home actor must be able to read its own suggestion').toBe(200)
      const homeBody = (await homeList.json()) as { items?: Array<{ id?: string }> }
      expect((homeBody.items ?? []).map((item) => item.id)).toEqual([suggestionId])

      const foreignTenantList = await apiRequest(request, 'GET', `${SUGGESTIONS_PATH}?ids=${encodeURIComponent(suggestionId)}`, {
        token: foreignTenant.token,
      })
      expect(foreignTenantList.status(), 'listing by a foreign-tenant id must not error').toBe(200)
      const foreignTenantBody = (await foreignTenantList.json()) as { items?: Array<{ id?: string }> }
      expect(foreignTenantBody.items ?? []).toEqual([])

      const foreignOrgList = await apiRequest(request, 'GET', `${SUGGESTIONS_PATH}?ids=${encodeURIComponent(suggestionId)}`, {
        token: foreignOrg.token,
      })
      expect(foreignOrgList.status(), 'listing by a foreign-organization (same tenant) id must not error').toBe(200)
      const foreignOrgBody = (await foreignOrgList.json()) as { items?: Array<{ id?: string }> }
      expect(foreignOrgBody.items ?? []).toEqual([])
    } finally {
      await deleteSuggestionIfExists(suggestionId)
      await cleanupSecondOrganizationActor(request, superadminToken, foreignOrg)
      await cleanupOmnibusTenantActor(request, superadminToken, foreignTenant)
      await cleanupOmnibusTenantActor(request, superadminToken, home)
    }
  })

  test('catalog.products.manage denial: accept answers 403 even with catalog.ai_categorization.use granted', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const stamp = uniqueStamp()
    let actor: OmnibusTenantActor | null = null
    let restricted: { roleId: string; userId: string; token: string } | null = null
    try {
      actor = await createOmnibusTenantActor(request, superadminToken, stamp, ['catalog.products.manage', 'catalog.settings.manage'])
      // Granted catalog.ai_categorization.use but NOT catalog.products.manage — the
      // route requires both (see `metadata.POST.requireFeatures` on the accept
      // route); this isolates the second feature from the first test's all-denied case.
      restricted = await createRestrictedUser(request, superadminToken, actor, stamp, ['catalog.ai_categorization.use'])
      const probeId = randomUUID()

      const accept = await apiRequest(request, 'POST', `${SUGGESTIONS_PATH}/${probeId}/accept`, {
        token: restricted.token,
        data: {},
      })
      expect(accept.status(), 'accept requires catalog.products.manage in addition to catalog.ai_categorization.use').toBe(403)
    } finally {
      await cleanupRestrictedUser(request, superadminToken, restricted)
      await cleanupOmnibusTenantActor(request, superadminToken, actor)
    }
  })
})
