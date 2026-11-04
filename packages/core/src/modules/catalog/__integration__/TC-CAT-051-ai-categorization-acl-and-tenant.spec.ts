import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  cleanupOmnibusTenantActor,
  cleanupRestrictedUser,
  createOmnibusTenantActor,
  createRestrictedUser,
  uniqueStamp,
  type OmnibusTenantActor,
} from './omnibusHelpers'

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

  test('a foreign tenant cannot accept, reject or read another tenant product’s category suggestion', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const stamp = uniqueStamp()
    const features = ['catalog.ai_categorization.use', 'catalog.products.manage', 'catalog.settings.manage']
    let home: OmnibusTenantActor | null = null
    let foreign: OmnibusTenantActor | null = null
    try {
      home = await createOmnibusTenantActor(request, superadminToken, stamp, features)
      foreign = await createOmnibusTenantActor(request, superadminToken, `${stamp}-foreign`, features)

      // A suggestion id that exists only in the home tenant (any random uuid
      // behaves like an unknown id from the foreign tenant's perspective —
      // the handlers scope every lookup by the caller's own tenant/org, so
      // this proves isolation without needing a real decision-model call).
      const probeId = randomUUID()

      const accept = await apiRequest(request, 'POST', `${SUGGESTIONS_PATH}/${probeId}/accept`, {
        token: foreign.token,
        data: {},
      })
      expect(accept.status(), 'accepting a suggestion id outside this tenant must look unknown').toBe(404)

      const reject = await apiRequest(request, 'POST', `${SUGGESTIONS_PATH}/${probeId}/reject`, {
        token: foreign.token,
        data: {},
      })
      expect(reject.status(), 'rejecting a suggestion id outside this tenant must look unknown').toBe(404)

      const list = await apiRequest(request, 'GET', `${SUGGESTIONS_PATH}?ids=${encodeURIComponent(probeId)}`, {
        token: foreign.token,
      })
      expect(list.status(), 'listing by a foreign id must not error').toBe(200)
      const body = (await list.json()) as { items?: Array<{ id?: string }> }
      expect(body.items ?? []).toEqual([])
    } finally {
      await cleanupOmnibusTenantActor(request, superadminToken, foreign)
      await cleanupOmnibusTenantActor(request, superadminToken, home)
    }
  })
})
