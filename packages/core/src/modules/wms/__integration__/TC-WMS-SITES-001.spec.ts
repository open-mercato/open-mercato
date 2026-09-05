import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getCustomFieldValue } from '@open-mercato/core/helpers/integration/crudFormFields'
import {
  deleteGeneralEntityIfExists,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectConflictBody, putWithLock } from '@open-mercato/core/helpers/integration/optimisticLockUi'
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { createCrudFixture, ensureRoleFeatures } from './helpers/wmsFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createOrganizationInDb,
  deleteOrganizationInDb,
  deleteUserAclInDb,
} from '@open-mercato/core/helpers/integration/dbFixtures'

export const integrationMeta = { dependsOnModules: ['wms'] }

const SITES_PATH = '/api/wms/sites'
const ROLES_PATH = '/api/wms/site-warehouse-roles'
const WAREHOUSES_PATH = '/api/wms/warehouses'

type ListBody<T> = { items?: T[] }
type SiteRow = {
  id?: string
  code?: string
  name?: string
  isActive?: boolean
  updatedAt?: string
  customValues?: Record<string, unknown>
  customFields?: unknown[]
}
type RoleRow = {
  id?: string
  siteId?: string
  warehouseId?: string
  role?: string
  isDefault?: boolean
  warehouse?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

const DEFINITIONS_PATH = '/api/entities/definitions'
const SITE_ENTITY_ID = 'wms:site'

async function listById<T>(request: APIRequestContext, token: string, path: string, id: string): Promise<T | null> {
  const response = await apiRequest(request, 'GET', `${path}?ids=${encodeURIComponent(id)}&page=1&pageSize=20`, { token })
  expect(response.status(), `GET ${path} by id`).toBe(200)
  const body = await readJsonSafe<ListBody<T>>(response)
  return body?.items?.[0] ?? null
}

function expectExactKeys(record: Record<string, unknown>, keys: string[]): void {
  expect(Object.keys(record).sort()).toEqual([...keys].sort())
}

test.describe('TC-WMS-SITES-001: Site and warehouse-role API contracts', () => {
  test('creates, updates and deactivates a Site with role-default invariants', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
      'wms.view',
      'wms.manage_sites',
      'wms.manage_warehouses',
    ])
    const restoreEmployeeAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'employee', [
      'wms.view',
    ])
    let siteId: string | null = null
    let warehouseAId: string | null = null
    let warehouseBId: string | null = null
    let roleAId: string | null = null
    let roleBId: string | null = null

    try {
      const denied = await apiRequest(request, 'POST', SITES_PATH, {
        token: employeeToken,
        data: { code: `DENIED${suffix}`, name: 'Denied site' },
      })
      expect(denied.status()).toBe(403)

      warehouseAId = await createCrudFixture(request, adminToken, WAREHOUSES_PATH, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC Site warehouse A ${suffix}`,
        code: `TCSWA${suffix}`,
        city: 'Gdansk', country: 'PL', timezone: 'Europe/Warsaw', isActive: true,
      })
      warehouseBId = await createCrudFixture(request, adminToken, WAREHOUSES_PATH, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC Site warehouse B ${suffix}`,
        code: `TCSWB${suffix}`,
        city: 'Gdansk', country: 'PL', timezone: 'Europe/Warsaw', isActive: true,
      })

      const created = await apiRequest(request, 'POST', SITES_PATH, {
        token: adminToken,
        data: { code: `site-${suffix}`, name: `TC Site ${suffix}` },
      })
      expect(created.status()).toBe(201)
      const createBody = await readJsonSafe<{ id?: string }>(created)
      siteId = createBody?.id ?? null
      expect(typeof siteId).toBe('string')

      const site = await listById<SiteRow>(request, adminToken, SITES_PATH, siteId ?? '')
      expect(site).toMatchObject({ id: siteId, code: `SITE-${suffix.toUpperCase()}`, name: `TC Site ${suffix}`, isActive: true })
      expect(typeof site?.updatedAt).toBe('string')
      expectExactKeys(site as Record<string, unknown>, [
        'id', 'code', 'name', 'isActive', 'customValues', 'customFields', 'createdAt', 'updatedAt',
      ])
      const employeeRead = await apiRequest(request, 'GET', `${SITES_PATH}?ids=${encodeURIComponent(siteId ?? '')}`, {
        token: employeeToken,
      })
      expect(employeeRead.status()).toBe(200)

      const firstRole = await apiRequest(request, 'POST', ROLES_PATH, {
        token: adminToken,
        data: { siteId, warehouseId: warehouseAId, role: 'raw_material' },
      })
      expect(firstRole.status()).toBe(201)
      roleAId = (await readJsonSafe<{ id?: string }>(firstRole))?.id ?? null
      const secondRole = await apiRequest(request, 'POST', ROLES_PATH, {
        token: adminToken,
        data: { siteId, warehouseId: warehouseBId, role: 'raw_material', isDefault: false },
      })
      expect(secondRole.status()).toBe(201)
      roleBId = (await readJsonSafe<{ id?: string }>(secondRole))?.id ?? null

      const rolesResponse = await apiRequest(request, 'GET', `${ROLES_PATH}?siteId=${encodeURIComponent(siteId ?? '')}&page=1&pageSize=25`, { token: adminToken })
      expect(rolesResponse.status()).toBe(200)
      const roles = (await readJsonSafe<ListBody<RoleRow>>(rolesResponse))?.items ?? []
      expect(roles).toHaveLength(2)
      expect(roles.filter((row) => row.isDefault)).toHaveLength(1)
      expect(roles.find((row) => row.id === roleAId)).toMatchObject({ warehouseId: warehouseAId, isDefault: true })
      expect(typeof roles.find((row) => row.id === roleAId)?.updatedAt).toBe('string')
      expectExactKeys(roles.find((row) => row.id === roleAId) as Record<string, unknown>, [
        'id', 'siteId', 'warehouseId', 'role', 'isDefault', 'warehouse', 'createdAt', 'updatedAt',
      ])

      const promoted = await apiRequest(request, 'PUT', ROLES_PATH, {
        token: adminToken,
        data: { id: roleBId, isDefault: true },
      })
      expect(promoted.status()).toBe(200)
      const promotedRoles = await apiRequest(request, 'GET', `${ROLES_PATH}?siteId=${encodeURIComponent(siteId ?? '')}&page=1&pageSize=25`, { token: adminToken })
      const afterPromotion = (await readJsonSafe<ListBody<RoleRow>>(promotedRoles))?.items ?? []
      expect(afterPromotion.filter((row) => row.isDefault)).toHaveLength(1)
      expect(afterPromotion.find((row) => row.id === roleBId)?.isDefault).toBe(true)

      const protectedDelete = await apiRequest(request, 'DELETE', `${ROLES_PATH}?id=${encodeURIComponent(roleBId ?? '')}`, { token: adminToken })
      expect(protectedDelete.status()).toBe(409)
      const deleteFirst = await apiRequest(request, 'DELETE', `${ROLES_PATH}?id=${encodeURIComponent(roleAId ?? '')}`, { token: adminToken })
      expect(deleteFirst.status()).toBe(200)
      roleAId = null
      const deleteLast = await apiRequest(request, 'DELETE', `${ROLES_PATH}?id=${encodeURIComponent(roleBId ?? '')}`, { token: adminToken })
      expect(deleteLast.status()).toBe(200)
      roleBId = null

      const updated = await apiRequest(request, 'PUT', SITES_PATH, {
        token: adminToken,
        data: { id: siteId, name: `TC Site updated ${suffix}`, isActive: false },
      })
      expect(updated.status()).toBe(200)
      const updatedSite = await listById<SiteRow>(request, adminToken, SITES_PATH, siteId ?? '')
      expect(updatedSite).toMatchObject({ name: `TC Site updated ${suffix}`, isActive: false })

      const siteDelete = await apiRequest(request, 'DELETE', `${SITES_PATH}?id=${encodeURIComponent(siteId ?? '')}`, { token: adminToken })
      expect(siteDelete.status()).toBe(404)
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, ROLES_PATH, roleAId)
      await deleteGeneralEntityIfExists(request, adminToken, ROLES_PATH, roleBId)
      if (siteId) await apiRequest(request, 'PUT', SITES_PATH, { token: adminToken, data: { id: siteId, isActive: false } }).catch(() => undefined)
      await deleteGeneralEntityIfExists(request, adminToken, WAREHOUSES_PATH, warehouseAId)
      await deleteGeneralEntityIfExists(request, adminToken, WAREHOUSES_PATH, warehouseBId)
      await restoreAdminAcl()
      await restoreEmployeeAcl()
    }
  })

  test('round-trips a Site custom field and restores it through command undo', async ({ request }) => {
    skipIfUndoTestsDisabled()
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const suffix = randomUUID().slice(0, 8)
    const customFieldKey = `site_note_${suffix}`
    const firstValue = `Initial note ${suffix}`
    const updatedValue = `Updated note ${suffix}`
    let siteId: string | null = null
    let definitionCreated = false

    try {
      const definition = await apiRequest(request, 'POST', DEFINITIONS_PATH, {
        token: adminToken,
        data: {
          entityId: SITE_ENTITY_ID,
          key: customFieldKey,
          kind: 'text',
          configJson: { label: `Site note ${suffix}`, formEditable: true, listVisible: true },
        },
      })
      expect(definition.status(), 'Site custom-field definition should be created').toBe(200)
      definitionCreated = true

      const created = await apiRequest(request, 'POST', SITES_PATH, {
        token: adminToken,
        data: {
          code: `CF${suffix}`,
          name: `Custom-field Site ${suffix}`,
          [`cf_${customFieldKey}`]: firstValue,
        },
      })
      expect(created.status()).toBe(201)
      siteId = (await readJsonSafe<{ id?: string }>(created))?.id ?? null
      expect(siteId).toBeTruthy()

      const createdSite = await listById<SiteRow>(request, adminToken, SITES_PATH, siteId ?? '')
      expect(createdSite).toBeTruthy()
      expect(getCustomFieldValue(createdSite ?? {}, customFieldKey)).toBe(firstValue)

      const update = await apiRequest(request, 'PUT', SITES_PATH, {
        token: adminToken,
        data: { id: siteId, [`cf_${customFieldKey}`]: updatedValue },
      })
      expect(update.status()).toBe(200)
      const updateOperation = expectOperation(update, 'wms.sites.update custom field')

      const changedSite = await listById<SiteRow>(request, adminToken, SITES_PATH, siteId ?? '')
      expect(getCustomFieldValue(changedSite ?? {}, customFieldKey)).toBe(updatedValue)

      await undoOk(request, adminToken, updateOperation.undoToken, 'wms.sites.update custom field')
      const restoredSite = await listById<SiteRow>(request, adminToken, SITES_PATH, siteId ?? '')
      expect(getCustomFieldValue(restoredSite ?? {}, customFieldKey)).toBe(firstValue)
    } finally {
      if (siteId)
        await apiRequest(request, 'PUT', SITES_PATH, {
          token: adminToken,
          data: { id: siteId, isActive: false },
        }).catch(() => undefined)
      if (definitionCreated)
        await apiRequest(request, 'DELETE', DEFINITIONS_PATH, {
          token: adminToken,
          data: { entityId: SITE_ENTITY_ID, key: customFieldKey },
        }).catch(() => undefined)
    }
  })

  test('rejects inactive warehouses and active-Site conflicts while allowing a replacement', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
      'wms.view',
      'wms.manage_sites',
      'wms.manage_warehouses',
    ])
    let firstSiteId: string | null = null
    let secondSiteId: string | null = null
    let activeWarehouseId: string | null = null
    let replacementWarehouseId: string | null = null
    let inactiveWarehouseId: string | null = null
    let firstRoleId: string | null = null
    let secondRoleId: string | null = null

    try {
      activeWarehouseId = await createCrudFixture(request, adminToken, WAREHOUSES_PATH, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `Shared warehouse ${suffix}`,
        code: `TCSH${suffix}`,
        city: 'Gdansk', country: 'PL', timezone: 'Europe/Warsaw', isActive: true,
      })
      replacementWarehouseId = await createCrudFixture(request, adminToken, WAREHOUSES_PATH, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `Replacement warehouse ${suffix}`,
        code: `TCRP${suffix}`,
        city: 'Gdansk', country: 'PL', timezone: 'Europe/Warsaw', isActive: true,
      })
      inactiveWarehouseId = await createCrudFixture(request, adminToken, WAREHOUSES_PATH, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `Inactive warehouse ${suffix}`,
        code: `TCIN${suffix}`,
        city: 'Gdansk', country: 'PL', timezone: 'Europe/Warsaw', isActive: false,
      })
      firstSiteId = await createCrudFixture(request, adminToken, SITES_PATH, {
        code: `FIRST${suffix}`, name: `First Site ${suffix}`,
      })
      secondSiteId = await createCrudFixture(request, adminToken, SITES_PATH, {
        code: `SECOND${suffix}`, name: `Second Site ${suffix}`,
      })
      firstRoleId = await createCrudFixture(request, adminToken, ROLES_PATH, {
        siteId: firstSiteId, warehouseId: activeWarehouseId, role: 'raw_material',
      })

      const inactiveAssignment = await apiRequest(request, 'POST', ROLES_PATH, {
        token: adminToken,
        data: { siteId: secondSiteId, warehouseId: inactiveWarehouseId, role: 'raw_material' },
      })
      expect(inactiveAssignment.status()).toBe(422)

      const activeSiteConflict = await apiRequest(request, 'POST', ROLES_PATH, {
        token: adminToken,
        data: { siteId: secondSiteId, warehouseId: activeWarehouseId, role: 'raw_material' },
      })
      expect(activeSiteConflict.status()).toBe(409)

      const replacement = await apiRequest(request, 'PUT', ROLES_PATH, {
        token: adminToken,
        data: { id: firstRoleId, warehouseId: replacementWarehouseId },
      })
      expect(replacement.status()).toBe(200)
      const firstRoles = await apiRequest(
        request,
        'GET',
        `${ROLES_PATH}?siteId=${encodeURIComponent(firstSiteId)}&page=1&pageSize=100`,
        { token: adminToken },
      )
      const firstRows = (await readJsonSafe<ListBody<RoleRow>>(firstRoles))?.items ?? []
      expect(firstRows.find((row) => row.id === firstRoleId)?.warehouseId).toBe(replacementWarehouseId)

      const releasedWarehouse = await apiRequest(request, 'POST', ROLES_PATH, {
        token: adminToken,
        data: { siteId: secondSiteId, warehouseId: activeWarehouseId, role: 'raw_material' },
      })
      expect(releasedWarehouse.status()).toBe(201)
      secondRoleId = (await readJsonSafe<{ id?: string }>(releasedWarehouse))?.id ?? null
      expect(secondRoleId).toBeTruthy()
    } finally {
      if (firstSiteId) await apiRequest(request, 'PUT', SITES_PATH, { token: adminToken, data: { id: firstSiteId, isActive: false } }).catch(() => undefined)
      if (secondSiteId) await apiRequest(request, 'PUT', SITES_PATH, { token: adminToken, data: { id: secondSiteId, isActive: false } }).catch(() => undefined)
      await deleteGeneralEntityIfExists(request, adminToken, ROLES_PATH, firstRoleId)
      await deleteGeneralEntityIfExists(request, adminToken, ROLES_PATH, secondRoleId)
      await deleteGeneralEntityIfExists(request, adminToken, WAREHOUSES_PATH, activeWarehouseId)
      await deleteGeneralEntityIfExists(request, adminToken, WAREHOUSES_PATH, replacementWarehouseId)
      await deleteGeneralEntityIfExists(request, adminToken, WAREHOUSES_PATH, inactiveWarehouseId)
      await restoreAdminAcl()
    }
  })

  test('rejects a stale Site update with the standard optimistic-lock body', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const suffix = randomUUID().slice(0, 8)
    let siteId: string | null = null

    try {
      siteId = await createCrudFixture(request, adminToken, SITES_PATH, {
        code: `LOCK${suffix}`, name: `Locked Site ${suffix}`,
      })
      const initial = await listById<SiteRow>(request, adminToken, SITES_PATH, siteId)
      expect(typeof initial?.updatedAt).toBe('string')

      const freshWrite = await apiRequest(request, 'PUT', SITES_PATH, {
        token: adminToken,
        data: { id: siteId, name: `Changed Site ${suffix}` },
      })
      expect(freshWrite.status()).toBe(200)

      const staleWrite = await putWithLock(
        request,
        adminToken,
        SITES_PATH,
        { id: siteId, name: `Stale Site ${suffix}` },
        initial?.updatedAt ?? '',
      )
      await expectConflictBody(staleWrite)
    } finally {
      if (siteId) await apiRequest(request, 'PUT', SITES_PATH, { token: adminToken, data: { id: siteId, isActive: false } }).catch(() => undefined)
    }
  })

  test('rejects stale warehouse-role update and delete requests', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
      'wms.view', 'wms.manage_sites', 'wms.manage_warehouses',
    ])
    let siteId: string | null = null
    let firstWarehouseId: string | null = null
    let secondWarehouseId: string | null = null
    let roleId: string | null = null
    try {
      firstWarehouseId = await createCrudFixture(request, adminToken, WAREHOUSES_PATH, {
        organizationId: scope.organizationId, tenantId: scope.tenantId,
        name: `Lock warehouse A ${suffix}`, code: `LWA${suffix}`,
        city: 'Gdansk', country: 'PL', timezone: 'Europe/Warsaw', isActive: true,
      })
      secondWarehouseId = await createCrudFixture(request, adminToken, WAREHOUSES_PATH, {
        organizationId: scope.organizationId, tenantId: scope.tenantId,
        name: `Lock warehouse B ${suffix}`, code: `LWB${suffix}`,
        city: 'Gdansk', country: 'PL', timezone: 'Europe/Warsaw', isActive: true,
      })
      siteId = await createCrudFixture(request, adminToken, SITES_PATH, {
        code: `RLOCK${suffix}`, name: `Role lock Site ${suffix}`,
      })
      roleId = await createCrudFixture(request, adminToken, ROLES_PATH, {
        siteId, warehouseId: firstWarehouseId, role: 'shipping',
      })
      const initial = await listById<RoleRow>(request, adminToken, ROLES_PATH, roleId)
      expect(typeof initial?.updatedAt).toBe('string')

      const fresh = await apiRequest(request, 'PUT', ROLES_PATH, {
        token: adminToken,
        data: { id: roleId, warehouseId: secondWarehouseId },
      })
      expect(fresh.status()).toBe(200)

      const staleUpdate = await putWithLock(
        request,
        adminToken,
        ROLES_PATH,
        { id: roleId, warehouseId: firstWarehouseId },
        initial?.updatedAt ?? '',
      )
      await expectConflictBody(staleUpdate)
      const staleDelete = await apiRequest(request, 'DELETE', `${ROLES_PATH}?id=${encodeURIComponent(roleId)}`, {
        token: adminToken,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: initial?.updatedAt ?? '' },
      })
      await expectConflictBody(staleDelete)
    } finally {
      if (siteId) await apiRequest(request, 'PUT', SITES_PATH, { token: adminToken, data: { id: siteId, isActive: false } }).catch(() => undefined)
      await deleteGeneralEntityIfExists(request, adminToken, ROLES_PATH, roleId)
      await deleteGeneralEntityIfExists(request, adminToken, WAREHOUSES_PATH, firstWarehouseId)
      await deleteGeneralEntityIfExists(request, adminToken, WAREHOUSES_PATH, secondWarehouseId)
      await restoreAdminAcl()
    }
  })

  test('restores warehouse-role update and delete operations through undo', async ({ request }) => {
    skipIfUndoTestsDisabled()
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
      'wms.view', 'wms.manage_sites', 'wms.manage_warehouses',
    ])
    let siteId: string | null = null
    let firstWarehouseId: string | null = null
    let secondWarehouseId: string | null = null
    let roleId: string | null = null
    try {
      firstWarehouseId = await createCrudFixture(request, adminToken, WAREHOUSES_PATH, {
        organizationId: scope.organizationId, tenantId: scope.tenantId,
        name: `Undo warehouse A ${suffix}`, code: `UWA${suffix}`,
        city: 'Gdansk', country: 'PL', timezone: 'Europe/Warsaw', isActive: true,
      })
      secondWarehouseId = await createCrudFixture(request, adminToken, WAREHOUSES_PATH, {
        organizationId: scope.organizationId, tenantId: scope.tenantId,
        name: `Undo warehouse B ${suffix}`, code: `UWB${suffix}`,
        city: 'Gdansk', country: 'PL', timezone: 'Europe/Warsaw', isActive: true,
      })
      siteId = await createCrudFixture(request, adminToken, SITES_PATH, {
        code: `RUNDO${suffix}`, name: `Role undo Site ${suffix}`,
      })
      roleId = await createCrudFixture(request, adminToken, ROLES_PATH, {
        siteId, warehouseId: firstWarehouseId, role: 'quarantine',
      })

      const update = await apiRequest(request, 'PUT', ROLES_PATH, {
        token: adminToken,
        data: { id: roleId, warehouseId: secondWarehouseId },
      })
      expect(update.status()).toBe(200)
      await undoOk(request, adminToken, expectOperation(update, 'role update').undoToken, 'role update')
      expect((await listById<RoleRow>(request, adminToken, ROLES_PATH, roleId))?.warehouseId).toBe(firstWarehouseId)

      const remove = await apiRequest(request, 'DELETE', `${ROLES_PATH}?id=${encodeURIComponent(roleId)}`, {
        token: adminToken,
      })
      expect(remove.status()).toBe(200)
      await undoOk(request, adminToken, expectOperation(remove, 'role delete').undoToken, 'role delete')
      expect((await listById<RoleRow>(request, adminToken, ROLES_PATH, roleId))?.id).toBe(roleId)
    } finally {
      if (siteId) await apiRequest(request, 'PUT', SITES_PATH, { token: adminToken, data: { id: siteId, isActive: false } }).catch(() => undefined)
      await deleteGeneralEntityIfExists(request, adminToken, ROLES_PATH, roleId)
      await deleteGeneralEntityIfExists(request, adminToken, WAREHOUSES_PATH, firstWarehouseId)
      await deleteGeneralEntityIfExists(request, adminToken, WAREHOUSES_PATH, secondWarehouseId)
      await restoreAdminAcl()
    }
  })

  test('serializes concurrent default promotion and active-Site claims', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
      'wms.view', 'wms.manage_sites', 'wms.manage_warehouses',
    ])
    const warehouseIds: string[] = []
    const siteIds: string[] = []
    const roleIds: string[] = []
    try {
      for (const marker of ['A', 'B', 'C', 'D']) {
        warehouseIds.push(await createCrudFixture(request, adminToken, WAREHOUSES_PATH, {
          organizationId: scope.organizationId, tenantId: scope.tenantId,
          name: `Race warehouse ${marker} ${suffix}`, code: `RW${marker}${suffix}`,
          city: 'Gdansk', country: 'PL', timezone: 'Europe/Warsaw', isActive: true,
        }))
      }
      const promotionSiteId = await createCrudFixture(request, adminToken, SITES_PATH, {
        code: `PROMO${suffix}`, name: `Promotion Site ${suffix}`,
      })
      siteIds.push(promotionSiteId)
      for (const warehouseId of warehouseIds.slice(0, 3)) {
        roleIds.push(await createCrudFixture(request, adminToken, ROLES_PATH, {
          siteId: promotionSiteId, warehouseId, role: 'line_side', isDefault: false,
        }))
      }
      const promotionResponses = await Promise.all([
        apiRequest(request, 'PUT', ROLES_PATH, { token: adminToken, data: { id: roleIds[1], isDefault: true }, retryTransport: false }),
        apiRequest(request, 'PUT', ROLES_PATH, { token: adminToken, data: { id: roleIds[2], isDefault: true }, retryTransport: false }),
      ])
      expect(promotionResponses.some((response) => response.status() === 200)).toBe(true)
      expect(promotionResponses.every((response) => [200, 409].includes(response.status()))).toBe(true)
      const promotedRows = await apiRequest(request, 'GET', `${ROLES_PATH}?siteId=${promotionSiteId}&role=line_side&pageSize=100`, { token: adminToken })
      expect(((await readJsonSafe<ListBody<RoleRow>>(promotedRows))?.items ?? []).filter((row) => row.isDefault)).toHaveLength(1)

      const sharedWarehouseId = warehouseIds[3]
      const claimantA = await createCrudFixture(request, adminToken, SITES_PATH, {
        code: `CLAIMA${suffix}`, name: `Claim Site A ${suffix}`, isActive: false,
      })
      const claimantB = await createCrudFixture(request, adminToken, SITES_PATH, {
        code: `CLAIMB${suffix}`, name: `Claim Site B ${suffix}`, isActive: false,
      })
      siteIds.push(claimantA, claimantB)
      roleIds.push(await createCrudFixture(request, adminToken, ROLES_PATH, {
        siteId: claimantA, warehouseId: sharedWarehouseId, role: 'shipping',
      }))
      roleIds.push(await createCrudFixture(request, adminToken, ROLES_PATH, {
        siteId: claimantB, warehouseId: sharedWarehouseId, role: 'shipping',
      }))
      const claimResponses = await Promise.all([
        apiRequest(request, 'PUT', SITES_PATH, { token: adminToken, data: { id: claimantA, isActive: true }, retryTransport: false }),
        apiRequest(request, 'PUT', SITES_PATH, { token: adminToken, data: { id: claimantB, isActive: true }, retryTransport: false }),
      ])
      expect(claimResponses.map((response) => response.status()).sort()).toEqual([200, 409])
      const claimantRows = await Promise.all(
        [claimantA, claimantB].map((id) => listById<SiteRow>(request, adminToken, SITES_PATH, id)),
      )
      expect(claimantRows.filter((row) => row?.isActive)).toHaveLength(1)
    } finally {
      for (const siteId of siteIds) {
        await apiRequest(request, 'PUT', SITES_PATH, { token: adminToken, data: { id: siteId, isActive: false } }).catch(() => undefined)
      }
      for (const roleId of roleIds) await deleteGeneralEntityIfExists(request, adminToken, ROLES_PATH, roleId)
      for (const warehouseId of warehouseIds) await deleteGeneralEntityIfExists(request, adminToken, WAREHOUSES_PATH, warehouseId)
      await restoreAdminAcl()
    }
  })

  test('does not expose or mutate Site records across organizations', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const password = 'StrongSecret123!'
    const email = `wms-sites-org-${suffix}@example.com`
    let organizationId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    let scopedToken: string | null = null
    let siteId: string | null = null
    let warehouseId: string | null = null
    let mappingId: string | null = null
    try {
      organizationId = await createOrganizationInDb({
        name: `WMS Sites organization ${suffix}`,
        tenantId: scope.tenantId,
      })
      roleId = await createRoleFixture(request, adminToken, {
        name: `WMS Sites organization role ${suffix}`,
      })
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
      })
      await setUserAclVisibility(request, adminToken, {
        userId,
        organizations: [organizationId],
        features: ['wms.view', 'wms.manage_sites', 'wms.manage_warehouses'],
      })
      scopedToken = await getAuthToken(request, email, password)
      warehouseId = await createCrudFixture(request, scopedToken, WAREHOUSES_PATH, {
        organizationId,
        tenantId: scope.tenantId,
        name: `Scoped warehouse ${suffix}`,
        code: `SCW${suffix}`,
        city: 'Gdansk', country: 'PL', timezone: 'Europe/Warsaw', isActive: true,
      })
      siteId = await createCrudFixture(request, scopedToken, SITES_PATH, {
        code: `SCOPED${suffix}`, name: `Scoped Site ${suffix}`,
      })
      mappingId = await createCrudFixture(request, scopedToken, ROLES_PATH, {
        siteId, warehouseId, role: 'raw_material',
      })

      expect(await listById<SiteRow>(request, scopedToken, SITES_PATH, siteId)).toMatchObject({ id: siteId })
      expect(await listById<SiteRow>(request, adminToken, SITES_PATH, siteId)).toBeNull()
      expect(await listById<RoleRow>(request, adminToken, ROLES_PATH, mappingId)).toBeNull()
      const foreignSiteUpdate = await apiRequest(request, 'PUT', SITES_PATH, {
        token: adminToken,
        data: { id: siteId, name: `Forbidden ${suffix}` },
      })
      expect(foreignSiteUpdate.status()).toBe(404)
      const foreignMappingUpdate = await apiRequest(request, 'PUT', ROLES_PATH, {
        token: adminToken,
        data: { id: mappingId, isDefault: true },
      })
      expect(foreignMappingUpdate.status()).toBe(404)
    } finally {
      if (scopedToken && siteId) await apiRequest(request, 'PUT', SITES_PATH, { token: scopedToken, data: { id: siteId, isActive: false } }).catch(() => undefined)
      if (scopedToken) await deleteGeneralEntityIfExists(request, scopedToken, ROLES_PATH, mappingId)
      if (scopedToken) await deleteGeneralEntityIfExists(request, scopedToken, WAREHOUSES_PATH, warehouseId)
      if (userId) await deleteUserAclInDb(userId)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteOrganizationInDb(organizationId)
    }
  })
})
