import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getCustomFieldValue } from '@open-mercato/core/helpers/integration/crudFormFields'
import {
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms'],
}

const DEFINITIONS_PATH = '/api/entities/definitions'
const ZONE_ENTITY_ID = 'wms:warehouse_zone'

type ZoneListResponse = { items?: Array<Record<string, unknown>> }

/**
 * "The tenant has exactly one warehouse" is the precondition under test, so it must be
 * established rather than inherited: a throwaway organization holds the single warehouse,
 * and a dedicated user whose ACL visibility is restricted to that organization drives the
 * browser. Forcing `om_selected_org` onto an organization the signed-in user cannot see is
 * silently ignored, which would leave the session in the seeded organization instead.
 */
async function createScopedFixture(
  request: APIRequestContext,
  token: string,
  selectedOrgId: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequestWithSelectedOrg(request, 'POST', path, {
    token,
    selectedOrgId,
    data,
  })
  expect(response.ok(), `Failed POST ${path}: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, `Missing id in ${path} create response`)
}

async function deleteScopedFixture(
  request: APIRequestContext,
  token: string | null,
  selectedOrgId: string | null,
  path: string,
  id: string | null,
): Promise<void> {
  if (!token || !selectedOrgId || !id) return
  await apiRequestWithSelectedOrg(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, {
    token,
    selectedOrgId,
  }).catch(() => undefined)
}

async function readZoneById(
  request: APIRequestContext,
  token: string,
  selectedOrgId: string,
  zoneId: string,
): Promise<Record<string, unknown> | null> {
  const response = await apiRequestWithSelectedOrg(
    request,
    'GET',
    `/api/wms/zones?ids=${encodeURIComponent(zoneId)}&page=1&pageSize=10`,
    { token, selectedOrgId },
  )
  expect(response.ok(), `Failed GET /api/wms/zones: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<ZoneListResponse>(response)
  return (body?.items ?? []).find((item) => item.id === zoneId) ?? null
}

/**
 * CrudForm renders its labels as plain text rather than associating them with the input,
 * so no field in the dialog exposes an accessible name and `getByLabel` matches nothing.
 * Target the field container instead, the way the rest of the suite does.
 *
 * Tracked as a framework-level defect in
 * https://github.com/open-mercato/open-mercato/issues/5360 — switch this helper to
 * `getByLabel` once the label/control association lands.
 */
function crudField(scope: Locator, fieldId: string): Locator {
  return scope.locator(`[data-crud-field-id="${fieldId}"] input`).first()
}

async function loginAsScopedUser(
  page: Page,
  email: string,
  password: string,
  tenantId: string,
  organizationId: string,
): Promise<void> {
  const form = new URLSearchParams()
  form.set('email', email)
  form.set('password', password)
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  expect(response.ok(), `Failed to login zone dialog test user: ${response.status()}`).toBeTruthy()

  const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:5001'
  await page.context().addCookies([
    { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' as const },
    { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' as const },
    { name: 'om_feedback_suppress', value: '1', url: baseUrl, sameSite: 'Lax' as const },
    { name: 'om_selected_tenant', value: tenantId, url: baseUrl, sameSite: 'Lax' as const },
    { name: 'om_selected_org', value: organizationId, url: baseUrl, sameSite: 'Lax' as const },
  ])
}

test.describe('TC-WMS-028: WMS create zone dialog (#5239)', () => {
  test('pre-selects the only warehouse and round-trips a custom field', async ({ page, request }) => {
    test.slow()

    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(superadminToken)
    const suffix = randomUUID().slice(0, 8)
    const customFieldKey = `zone_note_${suffix}`
    const customFieldLabel = `Zone Note ${suffix}`
    const customFieldValue = `Pick face ${suffix}`
    const warehouseName = `TC-WMS-028 Warehouse ${suffix}`
    const zoneCode = `TCW28Z${suffix}`
    const zoneName = `TC-WMS-028 Zone ${suffix}`
    const userEmail = `tc-wms-028-${suffix}@example.com`
    const userPassword = `Zone!${suffix}`

    let organizationId: string | null = null
    let userId: string | null = null
    let warehouseId: string | null = null
    let zoneId: string | null = null
    let customFieldCreated = false
    let userToken: string | null = null

    try {
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: `TC-WMS-028 Org ${suffix}`,
        tenantId: scope.tenantId,
      })

      userId = await createUserFixture(request, superadminToken, {
        email: userEmail,
        password: userPassword,
        organizationId,
        roles: ['employee'],
        name: `QA Zone Dialog ${suffix}`,
      })
      await setUserAclVisibility(request, superadminToken, {
        userId,
        features: ['wms.*', 'entities.*'],
        organizations: [organizationId],
      })
      userToken = await getAuthToken(request, userEmail, userPassword)

      warehouseId = await createScopedFixture(request, userToken, organizationId, '/api/wms/warehouses', {
        name: warehouseName,
        code: `TCW28W${suffix}`,
        isActive: true,
      })

      // Definitions are read back as `organizationId IN (auth.orgId, NULL)`, so the
      // definition has to be created from the same organization the browser session runs
      // in. Creating it unscoped stores it against the creator's own organization, and
      // the dialog then renders no custom field at all.
      const definitionResponse = await apiRequestWithSelectedOrg(request, 'POST', DEFINITIONS_PATH, {
        token: userToken,
        selectedOrgId: organizationId,
        data: {
          entityId: ZONE_ENTITY_ID,
          key: customFieldKey,
          kind: 'text',
          configJson: { label: customFieldLabel, formEditable: true, listVisible: true },
        },
      })
      expect(
        definitionResponse.ok(),
        `Failed to create ${ZONE_ENTITY_ID} custom field: ${definitionResponse.status()}`,
      ).toBeTruthy()
      customFieldCreated = true

      await loginAsScopedUser(page, userEmail, userPassword, scope.tenantId, organizationId)

      // The single warehouse must be the only one this session can see, otherwise the
      // "sole warehouse" precondition of #5239 is not actually under test.
      const warehousesResponse = await apiRequestWithSelectedOrg(
        request,
        'GET',
        '/api/wms/warehouses?page=1&pageSize=50',
        { token: userToken, selectedOrgId: organizationId },
      )
      expect(warehousesResponse.ok(), 'Failed GET /api/wms/warehouses').toBeTruthy()
      const warehousesBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(warehousesResponse)
      expect(
        (warehousesBody?.items ?? []).length,
        'Scoped organization should contain exactly one warehouse',
      ).toBe(1)

      await page.goto('/backend/wms/zones')

      const addZoneButton = page.getByRole('button', { name: /Add zone/i }).first()
      await expect(addZoneButton).toBeVisible({ timeout: 15_000 })
      await addZoneButton.click()

      const dialog = page.getByRole('dialog').filter({ hasText: /Create zone/i }).first()
      await expect(dialog).toBeVisible()

      // Requirement 1 (#5239): the single warehouse in scope is pre-selected, so the
      // operator never has to search for the only choice the form can accept.
      const warehouseInput = crudField(dialog, 'warehouseId')
      await expect(warehouseInput).toHaveValue(warehouseName, { timeout: 15_000 })

      // Requirement 2 (#5239): the CrudForm renders the entity's custom fields.
      const customFieldInput = crudField(dialog, `cf_${customFieldKey}`)
      await expect(customFieldInput).toBeVisible({ timeout: 15_000 })

      await crudField(dialog, 'code').fill(zoneCode)
      await crudField(dialog, 'name').fill(zoneName)
      await customFieldInput.fill(customFieldValue)
      await dialog.getByRole('button', { name: /Save/i }).click()
      await expect(dialog).toHaveCount(0, { timeout: 15_000 })

      const zoneRow = page.getByRole('row').filter({ hasText: zoneCode }).first()
      await expect(zoneRow).toBeVisible({ timeout: 15_000 })

      const listResponse = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `/api/wms/zones?search=${encodeURIComponent(zoneCode)}&page=1&pageSize=10`,
        { token: userToken, selectedOrgId: organizationId },
      )
      expect(listResponse.ok(), `Failed GET /api/wms/zones: ${listResponse.status()}`).toBeTruthy()
      const listBody = await readJsonSafe<ZoneListResponse>(listResponse)
      const createdZone = (listBody?.items ?? []).find((item) => item.code === zoneCode)
      expect(createdZone, `Zone ${zoneCode} should exist after saving the dialog`).toBeTruthy()
      zoneId = typeof createdZone?.id === 'string' ? createdZone.id : null
      expect(zoneId, 'Created zone should expose an id').toBeTruthy()
      expect(createdZone?.warehouse_id).toBe(warehouseId)

      // The custom field value entered in the dialog survives the write path.
      const persisted = await readZoneById(request, userToken, organizationId, zoneId!)
      expect(persisted, 'Created zone should be readable by id').toBeTruthy()
      expect(getCustomFieldValue(persisted!, customFieldKey)).toBe(customFieldValue)

      // ...and is hydrated back into the edit dialog rather than coming up blank.
      await page.reload()
      const reloadedRow = page.getByRole('row').filter({ hasText: zoneCode }).first()
      await expect(reloadedRow).toBeVisible({ timeout: 15_000 })
      await reloadedRow.getByRole('button').last().click()
      await page.getByRole('menuitem', { name: /Edit/i }).first().click()

      const editDialog = page.getByRole('dialog').filter({ hasText: /Edit zone/i }).first()
      await expect(editDialog).toBeVisible({ timeout: 15_000 })
      await expect(crudField(editDialog, `cf_${customFieldKey}`)).toHaveValue(customFieldValue, {
        timeout: 15_000,
      })
      await expect(crudField(editDialog, 'warehouseId')).toHaveValue(warehouseName)
    } finally {
      await deleteScopedFixture(request, userToken, organizationId, '/api/wms/zones', zoneId)
      await deleteScopedFixture(request, userToken, organizationId, '/api/wms/warehouses', warehouseId)
      if (customFieldCreated && userToken && organizationId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', DEFINITIONS_PATH, {
          token: userToken,
          selectedOrgId: organizationId,
          data: { entityId: ZONE_ENTITY_ID, key: customFieldKey },
        }).catch(() => undefined)
      }
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteOrganizationIfExists(request, superadminToken, organizationId)
    }
  })
})
