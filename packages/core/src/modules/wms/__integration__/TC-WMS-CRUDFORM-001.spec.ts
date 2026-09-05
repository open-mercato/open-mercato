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
 * custom field on create and update, and that list `search=` matches localized country
 * names (Poland → stored ISO `PL`).
 *
 * Isolation: writing a warehouse custom field upserts `entity_indexes`. Delete must
 * tombstone that row — a leftover live index document makes the hybrid engine treat
 * warehouses as indexed and hides later rows that were never upserted. Combined with
 * leftover CF definitions (query engine SELECTs `cf:*`) this emptied
 * `loadWarehouseOptions` for TC-WMS-INVENTORY-UI-001 on the same shard. Cleanup
 * therefore (1) tombstones the CF definition as the creating admin first, (2) deletes
 * leftover warehouses by id and unique code, (3) waits until a canary warehouse is
 * findable via `search=` (the combobox path), and (4) restores admin ACL in a nested
 * finally.
 */
const WAREHOUSES_PATH = '/api/wms/warehouses'
const DEFINITIONS_PATH = '/api/entities/definitions'
const WAREHOUSE_ENTITY_ID = 'wms:warehouse'
const ADMIN_WAREHOUSE_FEATURES = [
  'wms.view',
  'wms.manage_warehouses',
  'entities.definitions.manage',
] as const

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
      configJson: { label, formEditable: true, listVisible: true },
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
  await apiRequest(request, 'DELETE', DEFINITIONS_PATH, {
    token,
    data: { entityId: WAREHOUSE_ENTITY_ID, key },
  }).catch(() => undefined)
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

async function waitForWarehouseListHealthy(
  request: APIRequestContext,
  token: string | null,
): Promise<void> {
  if (!token) return
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const listResponse = await apiRequest(
      request,
      'GET',
      `${WAREHOUSES_PATH}?page=1&pageSize=1`,
      { token },
    ).catch(() => null)
    const searchResponse = await apiRequest(
      request,
      'GET',
      `${WAREHOUSES_PATH}?search=zzzz-health-check&page=1&pageSize=1`,
      { token },
    ).catch(() => null)
    if (listResponse?.status() === 200 && searchResponse?.status() === 200) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

async function waitUntilWarehouseSearchable(
  request: APIRequestContext,
  token: string,
  scope: { organizationId: string; tenantId: string },
): Promise<void> {
  const stamp = `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`
  const name = `QA isolation canary ${stamp}`
  const code = `QAIC${stamp}`.slice(0, 80)
  const canaryId = await createCrudFixture(request, token, WAREHOUSES_PATH, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    name,
    code,
    city: 'Gdynia',
    country: 'PL',
    timezone: 'Europe/Warsaw',
    isActive: true,
  })
  try {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await apiRequest(
        request,
        'GET',
        `${WAREHOUSES_PATH}?search=${encodeURIComponent(name)}&page=1&pageSize=20`,
        { token },
      ).catch(() => null)
      if (response?.status() === 200) {
        const body = await readJsonSafe<{ items?: CrudRecord[] }>(response)
        if ((body?.items ?? []).some((item) => item.id === canaryId)) return
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error(`[internal] warehouse list search did not return canary ${canaryId}`)
  } finally {
    await deleteGeneralEntityIfExists(request, token, WAREHOUSES_PATH, canaryId)
  }
}

async function deleteWarehousesByUniqueCode(
  request: APIRequestContext,
  token: string | null,
  code: string,
): Promise<void> {
  if (!token || !code) return
  await waitForWarehouseListHealthy(request, token)
  const response = await apiRequest(
    request,
    'GET',
    `${WAREHOUSES_PATH}?search=${encodeURIComponent(code)}&page=1&pageSize=20`,
    { token },
  ).catch(() => null)
  if (!response || response.status() !== 200) return
  const body = await readJsonSafe<{ items?: CrudRecord[] }>(response)
  for (const item of body?.items ?? []) {
    if (typeof item.id !== 'string') continue
    if (item.code !== code && item.name !== code) continue
    await deleteGeneralEntityIfExists(request, token, WAREHOUSES_PATH, item.id)
  }
}

async function restoreAdminAclSafely(restore: (() => Promise<void>) | null): Promise<void> {
  if (!restore) return
  await restore().catch(() => undefined)
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
    const warehouseCode = `QAWH${stamp}`.slice(0, 80)
    const warehouseName = `QA CRUDFORM Warehouse ${stamp}`
    const scope = getTokenScope(adminToken)
    let restoreAdminAcl: (() => Promise<void>) | null = null

    try {
      restoreAdminAcl = await ensureRoleFeatures(
        request,
        superadminToken,
        scope.tenantId,
        'admin',
        [...ADMIN_WAREHOUSE_FEATURES],
      )
      await createWarehouseCustomFieldDefinition(request, adminToken, dockKey, 'Dock code')

      await runCrudFormRoundTrip({
        request,
        token: adminToken,
        collectionPath: WAREHOUSES_PATH,
        readById: (id) => readWarehouseByIds(request, adminToken, id),
        create: {
          payload: {
            name: warehouseName,
            code: warehouseCode,
            city: 'Gdynia',
            country: 'PL',
            timezone: 'Europe/Warsaw',
            isActive: true,
            [`cf_${dockKey}`]: 'DOCK-A',
          },
        },
        expectAfterCreate: {
          scalars: {
            name: warehouseName,
            code: warehouseCode,
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
      try {
        await deleteWarehouseCustomFieldDefinition(request, adminToken, dockKey)
        await deleteWarehouseCustomFieldDefinition(request, superadminToken, dockKey)
        await deleteWarehousesByUniqueCode(request, adminToken, warehouseCode)
        await waitUntilWarehouseSearchable(request, adminToken, scope)
      } finally {
        await restoreAdminAclSafely(restoreAdminAcl)
      }
    }
  })
})

test.describe('TC-WMS-CRUDFORM-001: warehouse list search by country name', () => {
  test('search=Poland finds a warehouse stored as ISO code PL', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const stamp = `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`
    const warehouseCode = `QACS${stamp}`.slice(0, 80)
    const scope = getTokenScope(adminToken)
    let restoreAdminAcl: (() => Promise<void>) | null = null
    let warehouseId: string | null = null

    try {
      restoreAdminAcl = await ensureRoleFeatures(
        request,
        superadminToken,
        scope.tenantId,
        'admin',
        [...ADMIN_WAREHOUSE_FEATURES],
      )
      warehouseId = await createCrudFixture(request, adminToken, WAREHOUSES_PATH, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `QA Country Search ${stamp}`,
        code: warehouseCode,
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
      try {
        await deleteGeneralEntityIfExists(request, adminToken, WAREHOUSES_PATH, warehouseId)
        await deleteWarehousesByUniqueCode(request, adminToken, warehouseCode)
        await waitUntilWarehouseSearchable(request, adminToken, scope)
      } finally {
        await restoreAdminAclSafely(restoreAdminAcl)
      }
    }
  })
})
