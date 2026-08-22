import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe, deleteGeneralEntityIfExists } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  runCrudFormRoundTrip,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence'
import { createCrudFixture, ensureRoleFeatures } from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms'],
}

/**
 * TC-WMS-CRUDFORM-001: Warehouse CrudForm persists scalars + custom fields (#5238).
 *
 * Warehouses are created/edited from a shared CrudForm dialog. This spec proves the
 * command + list decorate path round-trips ISO country, IANA timezone, and a tenant
 * custom field on create and update. Self-contained: creates its own CF definition
 * and warehouses, then tombstones both in finally.
 */
const WAREHOUSES_PATH = '/api/wms/warehouses'
const DEFINITIONS_PATH = '/api/entities/definitions'
const WAREHOUSE_ENTITY_ID = 'wms:warehouse'

async function createWarehouseCustomFieldDefinition(
  request: APIRequestContext,
  token: string,
  key: string,
  label: string,
): Promise<void> {
  const response = await apiRequest(request, 'POST', DEFINITIONS_PATH, {
    token,
    data: {
      entityId: WAREHOUSE_ENTITY_ID,
      key,
      kind: 'text',
      configJson: { label },
    },
  })
  expect(
    response.status(),
    `POST ${DEFINITIONS_PATH} should create warehouse custom field "${key}"`,
  ).toBe(200)
}

async function deleteWarehouseCustomFieldDefinition(
  request: APIRequestContext,
  token: string | null,
  key: string,
): Promise<void> {
  if (!token) return
  const response = await apiRequest(request, 'DELETE', DEFINITIONS_PATH, {
    token,
    data: { entityId: WAREHOUSE_ENTITY_ID, key },
  })
  expect([200, 404]).toContain(response.status())
}

async function readWarehouseByIds(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(
    request,
    'GET',
    `${WAREHOUSES_PATH}?ids=${encodeURIComponent(id)}&page=1&pageSize=100`,
    { token },
  )
  expect(response.status(), `read-back warehouses failed: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<{ items?: CrudRecord[] }>(response)
  return (body?.items ?? []).find((item) => item.id === id) ?? null
}

test.describe('TC-WMS-CRUDFORM-001: Warehouse CrudForm persists scalars + custom fields', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled()
  })

  test('round-trips country, timezone, and a text custom field on create and update', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const stamp = `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`
    const dockKey = `dock_code_${stamp}`
    const scope = getTokenScope(adminToken)
    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      ['wms.view', 'wms.manage_warehouses'],
    )

    try {
      await createWarehouseCustomFieldDefinition(request, adminToken, dockKey, 'Dock code')

      await runCrudFormRoundTrip({
        request,
        token: adminToken,
        collectionPath: WAREHOUSES_PATH,
        readById: (id) => readWarehouseByIds(request, adminToken, id),
        create: {
          payload: {
            name: `QA CRUDFORM Warehouse ${stamp}`,
            code: `QAWH${stamp}`.slice(0, 80),
            city: 'Gdynia',
            country: 'PL',
            timezone: 'Europe/Warsaw',
            isActive: true,
            [`cf_${dockKey}`]: 'DOCK-A',
          },
        },
        expectAfterCreate: {
          scalars: {
            name: `QA CRUDFORM Warehouse ${stamp}`,
            code: `QAWH${stamp}`.slice(0, 80),
            city: 'Gdynia',
            country: 'PL',
            timezone: 'Europe/Warsaw',
          },
          customFields: {
            [dockKey]: 'DOCK-A',
          },
        },
        update: {
          payload: (id) => ({
            id,
            city: 'Krakow',
            country: 'DE',
            timezone: 'Europe/Berlin',
            [`cf_${dockKey}`]: 'DOCK-B',
          }),
        },
        expectAfterUpdate: {
          scalars: {
            city: 'Krakow',
            country: 'DE',
            timezone: 'Europe/Berlin',
          },
          customFields: {
            [dockKey]: 'DOCK-B',
          },
        },
      })
    } finally {
      await deleteWarehouseCustomFieldDefinition(request, adminToken, dockKey)
      await restoreAdminAcl()
    }
  })
})

test.describe('TC-WMS-CRUDFORM-001: warehouse list search by country name', () => {
  test('search=Poland finds a warehouse stored as ISO code PL', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const stamp = `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`
    const scope = getTokenScope(adminToken)
    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      ['wms.view', 'wms.manage_warehouses'],
    )
    let warehouseId: string | null = null

    try {
      warehouseId = await createCrudFixture(request, adminToken, WAREHOUSES_PATH, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `QA Country Search ${stamp}`,
        code: `QACS${stamp}`.slice(0, 80),
        city: 'Gdynia',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      const matched = await apiRequest(
        request,
        'GET',
        `${WAREHOUSES_PATH}?ids=${encodeURIComponent(warehouseId)}&search=${encodeURIComponent('Poland')}&page=1&pageSize=20`,
        { token: adminToken },
      )
      expect(matched.status(), 'search=Poland should succeed').toBe(200)
      const matchedBody = await readJsonSafe<{ items?: CrudRecord[] }>(matched)
      expect((matchedBody?.items ?? []).some((item) => item.id === warehouseId)).toBe(true)

      const missed = await apiRequest(
        request,
        'GET',
        `${WAREHOUSES_PATH}?ids=${encodeURIComponent(warehouseId)}&search=${encodeURIComponent('zzzz-no-country')}&page=1&pageSize=20`,
        { token: adminToken },
      )
      expect(missed.status()).toBe(200)
      const missedBody = await readJsonSafe<{ items?: CrudRecord[] }>(missed)
      expect((missedBody?.items ?? []).some((item) => item.id === warehouseId)).toBe(false)
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, WAREHOUSES_PATH, warehouseId)
      await restoreAdminAcl()
    }
  })
})
