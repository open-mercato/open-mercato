import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CAT-042: catalog.offers.delete reaches an offer in any allowed
 * organization, not just the selected one (#7612)
 *
 * `commandActorScope` used to pin the organization lookup to the caller's
 * currently selected organization instead of their full allowed set. The
 * `execute` step of `catalog.offers.delete` built its scope from
 * `commandActorScope`, while its own `prepare` step already used the
 * correctly-scoped `commandScopeWhere` — so a multi-organization actor whose
 * selected org differed from the offer's org got a 404 from `execute` even
 * though `prepare` had just found the record. This spec drives the real
 * endpoint against a real database and pins both sides of the boundary:
 * a second allowed organization now succeeds, and an organization outside the
 * allowed set still answers 404.
 */
async function getOrCreateChannel(request: APIRequestContext, token: string): Promise<string> {
  const listResponse = await apiRequest(request, 'GET', '/api/sales/channels?page=1&pageSize=1', { token })
  expect(listResponse.ok(), `Failed to list channels: ${listResponse.status()}`).toBeTruthy()
  const listBody = (await listResponse.json()) as { items?: Array<{ id: string }> }
  const existing = Array.isArray(listBody.items) ? listBody.items[0] : null
  if (existing?.id) return existing.id

  const stamp = Date.now()
  const createResponse = await apiRequest(request, 'POST', '/api/sales/channels', {
    token,
    data: { name: `QA Channel ${stamp}`, code: `qa-channel-${stamp}` },
  })
  expect(createResponse.ok(), `Failed to create channel fixture: ${createResponse.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ id?: string }>(createResponse)
  return expectId(body?.id, 'Channel creation response should include id')
}

async function createInOrg(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequestWithSelectedOrg(request, 'POST', path, {
    token,
    selectedOrgId: organizationId,
    data,
  })
  expect(response.status(), `POST ${path} should return 201`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, `POST ${path} should return an id`)
}

async function deleteInOrg(
  request: APIRequestContext,
  token: string,
  organizationId: string | null,
  path: string,
  id: string | null,
): Promise<void> {
  if (!organizationId || !id) return
  await apiRequestWithSelectedOrg(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, {
    token,
    selectedOrgId: organizationId,
  }).catch(() => undefined)
}

test.describe('TC-CAT-042: catalog.offers.delete honors the full allowed-organization set (#7612)', () => {
  test('a multi-organization actor deletes an offer outside their selected organization, but not one outside their scope', async ({ request }) => {
    test.setTimeout(60_000)
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { organizationId: homeOrganizationId, tenantId } = getTokenContext(superadminToken)
    const stamp = `${Date.now()}${randomInt(1_000_000)}`
    const password = 'StrongSecret123!'
    const email = `qa-tc-cat-042-${stamp}@example.com`

    let orgSecond: string | null = null
    let orgOutside: string | null = null
    let productInSecond: string | null = null
    let productOutside: string | null = null
    let offerInSecond: string | null = null
    let offerOutside: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      const channelId = await getOrCreateChannel(request, superadminToken)
      orgSecond = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-CAT-042 Second ${stamp}`,
        tenantId,
      })
      orgOutside = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-CAT-042 Outside ${stamp}`,
        tenantId,
      })

      productInSecond = await createInOrg(request, superadminToken, orgSecond, '/api/catalog/products', {
        title: `QA 042 Second Product ${stamp}`,
        sku: `QA-042-SECOND-${stamp}`,
      })
      offerInSecond = await createInOrg(request, superadminToken, orgSecond, '/api/catalog/offers', {
        title: `QA 042 Second Offer ${stamp}`,
        productId: productInSecond,
        channelId,
      })

      productOutside = await createInOrg(request, superadminToken, orgOutside, '/api/catalog/products', {
        title: `QA 042 Outside Product ${stamp}`,
        sku: `QA-042-OUTSIDE-${stamp}`,
      })
      offerOutside = await createInOrg(request, superadminToken, orgOutside, '/api/catalog/offers', {
        title: `QA 042 Outside Offer ${stamp}`,
        productId: productOutside,
        channelId,
      })

      roleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-cat-042-${stamp}` })
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId: homeOrganizationId,
        roles: [roleId],
        name: 'QA TC-CAT-042 Actor',
      })
      // Allowed in homeOrganizationId (the actor's selected org at login) AND
      // orgSecond, but NOT orgOutside.
      await setUserAclVisibility(request, superadminToken, {
        userId,
        organizations: [homeOrganizationId, orgSecond],
        features: ['sales.channels.manage'],
      })
      const actorToken = await getAuthToken(request, email, password)

      const deleteAllowed = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/offers?id=${encodeURIComponent(offerInSecond)}`,
        { token: actorToken },
      )
      expect(
        deleteAllowed.status(),
        'deleting an offer in a second allowed organization (not the selected one) must succeed',
      ).toBe(200)

      const stillListed = await apiRequest(
        request,
        'GET',
        `/api/catalog/offers?id=${encodeURIComponent(offerInSecond)}`,
        { token: superadminToken },
      )
      const stillListedBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(stillListed)
      const found = (stillListedBody?.items ?? []).some((item) => item.id === offerInSecond)
      expect(found, 'the deleted offer must no longer appear in the list').toBe(false)

      const deleteDenied = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/offers?id=${encodeURIComponent(offerOutside)}`,
        { token: actorToken },
      )
      expect(
        deleteDenied.status(),
        'deleting an offer outside the allowed-organization set must still answer 404',
      ).toBe(404)
    } finally {
      await deleteInOrg(request, superadminToken, orgOutside, '/api/catalog/offers', offerOutside)
      await deleteInOrg(request, superadminToken, orgOutside, '/api/catalog/products', productOutside)
      await deleteInOrg(request, superadminToken, orgSecond, '/api/catalog/products', productInSecond)
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationIfExists(request, superadminToken, orgOutside)
      await deleteOrganizationIfExists(request, superadminToken, orgSecond)
    }
  })
})
