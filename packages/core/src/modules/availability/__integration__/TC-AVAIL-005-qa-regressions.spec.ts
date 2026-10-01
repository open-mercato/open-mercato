import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createVariantFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { deleteGeneralEntityIfExists, expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AVAIL-005 — regressions from the #6709 QA pass.
 *
 * - #6805: the check tool and policy writes validate the variant against the product.
 * - #6806: an inactive policy with a future preorder date keeps an untracked item unpurchasable.
 * - #6807: list and resolve-preview read the organization selected in the header (check shares the resolver).
 * - #6808: a non-UUID id or an integer above the Postgres range is a 400, never a 500.
 */

const CHECK_API_BASE = '/api/availability/check'
const POLICIES_API_BASE = '/api/availability/policies'
const PREVIEW_API_BASE = '/api/availability/policies/resolve-preview'
const CATALOG_PRODUCTS_API_BASE = '/api/catalog/products'

function syntheticUuid(stamp: number, suffix: string): string {
  return `00000000-0000-4000-${suffix}-${String(stamp).slice(-12).padStart(12, '0')}`
}

test.describe('TC-AVAIL-005: availability QA regressions', () => {
  test('#6805: a variant of another product or an unknown variant is rejected by check and policy writes', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(token)
    const stamp = Date.now()

    let productAId: string | null = null
    let productBId: string | null = null
    let foreignPolicyId: string | null = null
    try {
      const createA = await apiRequest(request, 'POST', CATALOG_PRODUCTS_API_BASE, {
        token,
        data: { tenantId, organizationId, title: `QA AVAIL 005 A ${stamp}`, sku: `qa-avail-005a-${stamp}` },
      })
      test.skip(createA.status() >= 400, `catalog product fixture create failed with ${createA.status()}`)
      productAId = expectId((await readJsonSafe<{ id?: string }>(createA))?.id, 'product A id')
      const createB = await apiRequest(request, 'POST', CATALOG_PRODUCTS_API_BASE, {
        token,
        data: { tenantId, organizationId, title: `QA AVAIL 005 B ${stamp}`, sku: `qa-avail-005b-${stamp}` },
      })
      expect(createB.status()).toBeLessThan(400)
      productBId = expectId((await readJsonSafe<{ id?: string }>(createB))?.id, 'product B id')
      const variantBId = await createVariantFixture(request, token, {
        productId: productBId,
        name: `QA AVAIL 005 B variant ${stamp}`,
        sku: `qa-avail-005b-v-${stamp}`,
      })

      const ownVariant = await apiRequest(request, 'POST', CHECK_API_BASE, {
        token,
        data: { productId: productBId, variantId: variantBId, quantity: 1 },
      })
      expect(ownVariant.status(), 'a product checked with its own variant should be 200').toBe(200)

      const foreignVariant = await apiRequest(request, 'POST', CHECK_API_BASE, {
        token,
        data: { productId: productAId, variantId: variantBId, quantity: 1 },
      })
      expect(foreignVariant.status(), 'a variant of another product must be a 400').toBe(400)

      const unknownVariant = await apiRequest(request, 'POST', CHECK_API_BASE, {
        token,
        data: { productId: productAId, variantId: syntheticUuid(stamp, '8051'), quantity: 1 },
      })
      expect(unknownVariant.status(), 'an unknown variant must be a 404').toBe(404)

      const foreignPolicy = await apiRequest(request, 'POST', POLICIES_API_BASE, {
        token,
        data: { tenantId, organizationId, productId: productAId, variantId: variantBId },
      })
      if (foreignPolicy.status() < 300) {
        foreignPolicyId = (await readJsonSafe<{ id?: string }>(foreignPolicy))?.id ?? null
      }
      expect(foreignPolicy.status(), 'a policy for a variant of another product must be a 400').toBe(400)
    } finally {
      await deleteGeneralEntityIfExists(request, token, POLICIES_API_BASE, foreignPolicyId)
      await deleteCatalogProductIfExists(request, token, productAId)
      await deleteCatalogProductIfExists(request, token, productBId)
    }
  })

  test('#6806: an inactive policy with a future preorder date keeps an untracked product unpurchasable', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(token)
    const stamp = Date.now()

    let productId: string | null = null
    let policyId: string | null = null
    try {
      const createProduct = await apiRequest(request, 'POST', CATALOG_PRODUCTS_API_BASE, {
        token,
        data: { tenantId, organizationId, title: `QA AVAIL 005c ${stamp}`, sku: `qa-avail-005c-${stamp}` },
      })
      test.skip(createProduct.status() >= 400, `catalog product fixture create failed with ${createProduct.status()}`)
      productId = expectId((await readJsonSafe<{ id?: string }>(createProduct))?.id, 'catalog product id')

      const createPolicy = await apiRequest(request, 'POST', POLICIES_API_BASE, {
        token,
        data: {
          tenantId,
          organizationId,
          productId,
          isStockManaged: false,
          isActive: false,
          preorderReleaseAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        },
      })
      expect(createPolicy.status()).toBe(201)
      policyId = expectId((await readJsonSafe<{ id?: string }>(createPolicy))?.id, 'policy id')

      const check = await apiRequest(request, 'POST', CHECK_API_BASE, { token, data: { productId, quantity: 1 } })
      expect(check.status()).toBe(200)
      const body = await readJsonSafe<{ availability?: { state?: string; canFulfil?: boolean } }>(check)
      expect(body?.availability?.state).toBe('out_of_stock')
      expect(body?.availability?.canFulfil).toBe(false)
    } finally {
      await deleteGeneralEntityIfExists(request, token, POLICIES_API_BASE, policyId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('#6807: list and resolve-preview read the organization selected in the header', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(adminToken)
    const stamp = Date.now()
    const productId = syntheticUuid(stamp, '8052')

    let orgBId: string | null = null
    let policyId: string | null = null
    try {
      orgBId = await createOrganizationFixture(request, superadminToken, { name: `QA AVAIL 005 Org B ${stamp}`, tenantId })

      const create = await apiRequestWithSelectedOrg(request, 'POST', POLICIES_API_BASE, {
        token: adminToken,
        selectedOrgId: orgBId,
        data: { tenantId, organizationId: orgBId, productId, lowStockThreshold: 7 },
      })
      expect(create.status(), 'creating a policy in the selected organization should be 201').toBe(201)
      policyId = expectId((await readJsonSafe<{ id?: string }>(create))?.id, 'policy id')

      const selectedList = await apiRequestWithSelectedOrg(request, 'GET', `${POLICIES_API_BASE}?productId=${productId}`, {
        token: adminToken,
        selectedOrgId: orgBId,
      })
      expect(selectedList.status()).toBe(200)
      const selectedBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(selectedList)
      expect((selectedBody?.items ?? []).map((item) => item.id), 'the selected-org list must show the new policy').toContain(
        policyId,
      )

      const homeList = await apiRequest(request, 'GET', `${POLICIES_API_BASE}?productId=${productId}`, { token: adminToken })
      expect(homeList.status()).toBe(200)
      const homeBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(homeList)
      expect((homeBody?.items ?? []).map((item) => item.id), 'the home-org list must not show it').not.toContain(policyId)

      const preview = await apiRequestWithSelectedOrg(request, 'GET', `${PREVIEW_API_BASE}?productId=${productId}`, {
        token: adminToken,
        selectedOrgId: orgBId,
      })
      expect(preview.status()).toBe(200)
      const previewBody = await readJsonSafe<{
        policyTrace?: { lowStockThreshold?: { value?: number | null; policySourceId?: string | null } }
      }>(preview)
      expect(previewBody?.policyTrace?.lowStockThreshold?.value).toBe(7)
      expect(previewBody?.policyTrace?.lowStockThreshold?.policySourceId).toBe(policyId)
    } finally {
      if (policyId && orgBId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', `${POLICIES_API_BASE}?id=${encodeURIComponent(policyId)}`, {
          token: adminToken,
          selectedOrgId: orgBId,
        }).catch(() => undefined)
      }
      await deleteOrganizationIfExists(request, superadminToken, orgBId)
    }
  })

  test('#6808: a non-UUID id or an out-of-range integer is a 400, never a 500', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(token)
    const stamp = Date.now()

    const badPut = await apiRequest(request, 'PUT', POLICIES_API_BASE, {
      token,
      data: { id: 'abc', lowStockThreshold: 1 },
    })
    expect(badPut.status(), 'PUT with a non-UUID id must be a 400').toBe(400)

    const badDelete = await apiRequest(request, 'DELETE', `${POLICIES_API_BASE}?id=abc`, { token })
    expect(badDelete.status(), 'DELETE with a non-UUID id must be a 400').toBe(400)

    for (const field of ['maxOrderQuantity', 'lowStockThreshold']) {
      const overflow = await apiRequest(request, 'POST', POLICIES_API_BASE, {
        token,
        data: { tenantId, organizationId, productId: syntheticUuid(stamp, '8053'), [field]: 2147483648 },
      })
      expect(overflow.status(), `${field} above the integer range must be a 400`).toBe(400)
    }
  })
})
