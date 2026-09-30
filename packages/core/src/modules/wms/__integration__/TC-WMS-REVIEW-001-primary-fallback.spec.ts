import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createOrganizationFixture, deleteOrganizationIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { ensureRoleFeatures } from './helpers/wmsFixtures'
import {
  createSite,
  createWarehouse,
  deactivateResource,
  deleteResource,
  listWarehouses,
  WAREHOUSES_PATH,
} from './helpers/wmsReviewFixtures'

export const integrationMeta = { dependsOnModules: ['wms'] }

test('TC-WMS-REVIEW-001: deleting the primary warehouse promotes the remaining warehouse', async ({ request }) => {
  test.slow()
  const superadminToken = await getAuthToken(request, 'superadmin')
  const scope = getTokenScope(superadminToken)
  const restoreAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'superadmin', ['wms.view', 'wms.manage_sites', 'wms.manage_warehouses'])
  const suffix = randomUUID().slice(0, 8)
  let organizationId: string | null = null
  let siteId: string | null = null
  let firstWarehouseId: string | null = null
  let secondWarehouseId: string | null = null
  try {
    organizationId = await createOrganizationFixture(request, superadminToken, {
      name: `Primary fallback organization ${suffix}`,
      tenantId: scope.tenantId,
    })
    const testScope = { ...scope, organizationId }
    siteId = await createSite(request, superadminToken, testScope, `Primary fallback site ${suffix}`, `PFS${suffix}`, organizationId)
    firstWarehouseId = await createWarehouse(request, superadminToken, testScope, `Primary fallback A ${suffix}`, `PFA${suffix}`, { organizationId, isPrimary: true })
    secondWarehouseId = await createWarehouse(request, superadminToken, testScope, `Primary fallback B ${suffix}`, `PFB${suffix}`, { organizationId, isPrimary: true })

    const beforeDelete = await listWarehouses(request, superadminToken, organizationId)
    expect(beforeDelete.find((item) => item.id === secondWarehouseId)?.is_primary).toBe(true)
    expect(beforeDelete.find((item) => item.id === firstWarehouseId)?.is_primary).toBe(false)

    const deleteResponse = await apiRequest(request, 'DELETE', `${WAREHOUSES_PATH}?id=${encodeURIComponent(secondWarehouseId)}`, {
      token: superadminToken,
      headers: { Cookie: `om_selected_org=${organizationId}` },
    })
    expect(deleteResponse.status()).toBe(200)
    const afterDelete = await listWarehouses(request, superadminToken, organizationId)
    expect(afterDelete.find((item) => item.id === firstWarehouseId)?.is_primary).toBe(true)
  } finally {
    await deactivateResource(request, superadminToken, '/api/wms/sites', siteId, organizationId ?? undefined)
    await deleteResource(request, superadminToken, WAREHOUSES_PATH, secondWarehouseId, organizationId ?? undefined)
    await deleteResource(request, superadminToken, WAREHOUSES_PATH, firstWarehouseId, organizationId ?? undefined)
    await deleteOrganizationIfExists(request, superadminToken, organizationId)
    await restoreAcl()
  }
})
