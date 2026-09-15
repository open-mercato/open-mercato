import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteGeneralEntityIfExists, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  bumpRecordViaApi,
  expectConflictBanner,
  expectNoConflictBanner,
} from '@open-mercato/core/helpers/integration/optimisticLockUi'
import { createCrudFixture, ensureRoleFeatures } from './helpers/wmsFixtures'

export const integrationMeta = { dependsOnModules: ['wms'] }

test.describe('TC-WMS-SITES-UI-001: Site management UI', () => {
  test('hydrates the list, create, and edit routes and preserves dialog keyboard behaviour', async ({ page, request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', ['wms.view', 'wms.manage_sites'])
    let siteId: string | null = null
    try {
      const created = await apiRequest(request, 'POST', '/api/wms/sites', {
        token: adminToken,
        data: { code: `UI${suffix}`, name: `Site UI ${suffix}` },
      })
      expect(created.status()).toBe(201)
      siteId = (await readJsonSafe<{ id?: string }>(created))?.id ?? null

      await login(page, 'admin')
      await page.goto('/backend/wms/sites')
      await expect(page.getByRole('heading', { name: /Sites/i })).toBeVisible()
      await expect(page.getByText(`Site UI ${suffix}`)).toBeVisible()
      await expect(page.getByRole('button', { name: /Create site/i })).toBeVisible()

      await page.goto('/backend/wms/sites/create')
      const createForm = page.locator('main')
      await expect(createForm.getByRole('textbox')).toHaveCount(2)
      await expect(createForm.getByRole('textbox').nth(0)).toBeVisible()
      await expect(createForm.getByRole('textbox').nth(1)).toBeVisible()
      await expect(createForm.getByRole('checkbox', { name: /Active/i })).toBeChecked()

      await page.goto(`/backend/wms/sites/${encodeURIComponent(siteId ?? '')}`)
      const editForm = page.locator('main')
      await expect(editForm.getByRole('textbox').nth(0)).toHaveValue(`UI${suffix.toUpperCase()}`)
      await expect(editForm.getByRole('textbox').nth(1)).toHaveValue(`Site UI ${suffix}`)
      await expect(page.getByRole('heading', { name: /Warehouse roles/i })).toBeVisible()
      await page.getByRole('button', { name: /Add warehouse role/i }).first().click()
      const dialog = page.getByRole('dialog').filter({ hasText: /Add warehouse role/i })
      await expect(dialog).toBeVisible()
      await dialog.press('Escape')
      await expect(dialog).toHaveCount(0)
    } finally {
      if (siteId) await apiRequest(request, 'PUT', '/api/wms/sites', { token: adminToken, data: { id: siteId, isActive: false } }).catch(() => undefined)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/site-warehouse-roles', null)
      await restoreAdminAcl()
    }
  })

  test('creates a Site and warehouse role through the UI, including empty state, keyboard submit, and inactive warning', async ({ page, request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const warehouseName = `UI warehouse ${suffix}`
    const siteCode = `UIS${suffix}`
    const siteName = `UI Site ${suffix}`
    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
      'wms.view',
      'wms.manage_sites',
      'wms.manage_warehouses',
    ])
    let warehouseId: string | null = null
    let siteId: string | null = null
    let roleId: string | null = null

    try {
      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: warehouseName,
        code: `UIW${suffix}`,
        city: 'Gdansk', country: 'PL', timezone: 'Europe/Warsaw', isActive: true,
      })

      await login(page, 'admin')
      await page.goto('/backend/wms/sites/create')
      await page.locator('[data-crud-field-id="code"] input').fill(siteCode)
      await page.locator('[data-crud-field-id="name"] input').fill(siteName)
      await page.getByRole('button', { name: /Create site/i }).first().click()
      await expect(page).toHaveURL(/\/backend\/wms\/sites\/[0-9a-f-]+/i, { timeout: 15_000 })
      siteId = page.url().split('/').pop() ?? null
      expect(siteId).toBeTruthy()

      await expect(page.getByText(/No warehouse roles/i)).toBeVisible()
      await expect(page.getByRole('button', { name: /Export|Columns|Bulk/i })).toHaveCount(0)

      await page.getByRole('button', { name: /Add warehouse role/i }).first().click()
      const dialog = page.getByRole('dialog').filter({ hasText: /Add warehouse role/i })
      await expect(dialog).toBeVisible()
      const warehouseInput = dialog.locator('[data-crud-field-id="warehouseId"] input').first()
      await warehouseInput.fill(warehouseName)
      await page.getByText(warehouseName, { exact: true }).last().click()
      const createRoleResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes('/api/wms/site-warehouse-roles'),
      )
      await dialog.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
      const createRoleResponse = await createRoleResponsePromise
      expect(createRoleResponse.status()).toBe(201)
      roleId = ((await createRoleResponse.json()) as { id?: string }).id ?? null
      expect(roleId).toBeTruthy()
      await expect(dialog).toHaveCount(0, { timeout: 15_000 })
      const roleRow = page.getByRole('row').filter({ hasText: warehouseName })
      await expect(roleRow).toBeVisible({ timeout: 15_000 })
      await expect(roleRow).toContainText(/Yes/i)

      const deactivate = await apiRequest(request, 'PUT', '/api/wms/warehouses', {
        token: adminToken,
        data: { id: warehouseId, isActive: false },
      })
      expect(deactivate.status()).toBe(200)
      await page.reload()
      await expect(page.getByText(/Warehouse inactive/i)).toBeVisible({ timeout: 15_000 })
    } finally {
      if (siteId) await apiRequest(request, 'PUT', '/api/wms/sites', { token: adminToken, data: { id: siteId, isActive: false } }).catch(() => undefined)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/site-warehouse-roles', roleId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await restoreAdminAcl()
    }
  })

  test('surfaces a Site optimistic-lock conflict after a stale browser save', async ({ page, request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', ['wms.view', 'wms.manage_sites'])
    let siteId: string | null = null

    try {
      siteId = await createCrudFixture(request, adminToken, '/api/wms/sites', {
        code: `UIC${suffix}`, name: `Conflict Site ${suffix}`,
      })
      await login(page, 'admin')
      await page.goto(`/backend/wms/sites/${encodeURIComponent(siteId)}`)
      await expect(page.locator('[data-crud-field-id="name"] input')).toHaveValue(`Conflict Site ${suffix}`)

      await bumpRecordViaApi(
        request,
        adminToken,
        '/api/wms/sites',
        { id: siteId, name: `Changed elsewhere ${suffix}` },
      )
      await page.locator('[data-crud-field-id="name"] input').fill(`Stale browser save ${suffix}`)
      await page.getByRole('button', { name: /Save changes/i }).first().click()
      await expectConflictBanner(page, { timeout: 15_000 })
    } finally {
      if (siteId) await apiRequest(request, 'PUT', '/api/wms/sites', { token: adminToken, data: { id: siteId, isActive: false } }).catch(() => undefined)
      await restoreAdminAcl()
    }
  })

  test('edits, promotes, conflicts, and deletes warehouse roles through the UI', async ({ page, request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
      'wms.view', 'wms.manage_sites', 'wms.manage_warehouses',
    ])
    const warehouseAName = `Role A ${suffix}`
    const warehouseBName = `Role B ${suffix}`
    let warehouseAId: string | null = null
    let warehouseBId: string | null = null
    let siteId: string | null = null
    let roleAId: string | null = null
    let roleBId: string | null = null

    try {
      warehouseAId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: warehouseAName,
        code: `UIA${suffix}`,
        city: 'Gdansk', country: 'PL', timezone: 'Europe/Warsaw', isActive: true,
      })
      warehouseBId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: warehouseBName,
        code: `UIB${suffix}`,
        city: 'Gdansk', country: 'PL', timezone: 'Europe/Warsaw', isActive: true,
      })
      siteId = await createCrudFixture(request, adminToken, '/api/wms/sites', {
        code: `UIR${suffix}`, name: `Role UI ${suffix}`,
      })
      roleAId = await createCrudFixture(request, adminToken, '/api/wms/site-warehouse-roles', {
        siteId, warehouseId: warehouseAId, role: 'raw_material',
      })
      roleBId = await createCrudFixture(request, adminToken, '/api/wms/site-warehouse-roles', {
        siteId, warehouseId: warehouseBId, role: 'raw_material',
      })

      await login(page, 'admin')
      await page.goto(`/backend/wms/sites/${encodeURIComponent(siteId)}`)
      let roleBRow = page.getByRole('row').filter({ hasText: warehouseBName })
      await expect(roleBRow).toBeVisible({ timeout: 15_000 })
      await roleBRow.getByRole('button', { name: /open actions/i }).click()
      await page.getByRole('menuitem', { name: /^Edit$/i }).click()
      let dialog = page.getByRole('dialog').filter({ hasText: /Edit warehouse role/i })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('checkbox', { name: /Use as the default warehouse/i }).check()
      const promoteResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          response.url().includes('/api/wms/site-warehouse-roles'),
      )
      await dialog.getByRole('button', { name: /^Save$/i }).click()
      expect((await promoteResponsePromise).status()).toBe(200)
      await expect(dialog).toHaveCount(0, { timeout: 15_000 })
      roleBRow = page.getByRole('row').filter({ hasText: warehouseBName })
      await expect(roleBRow).toContainText(/Yes/i, { timeout: 15_000 })

      let roleARow = page.getByRole('row').filter({ hasText: warehouseAName })
      await roleARow.getByRole('button', { name: /open actions/i }).click()
      await page.getByRole('menuitem', { name: /^Edit$/i }).click()
      dialog = page.getByRole('dialog').filter({ hasText: /Edit warehouse role/i })
      await expect(dialog).toBeVisible()
      await bumpRecordViaApi(
        request,
        adminToken,
        '/api/wms/site-warehouse-roles',
        { id: roleAId, isDefault: false },
      )
      await dialog.getByRole('checkbox', { name: /Use as the default warehouse/i }).check()
      await dialog.getByRole('button', { name: /^Save$/i }).click()
      await expectConflictBanner(page, { timeout: 15_000 })
      await dialog.press('Escape')
      await expect(dialog).toHaveCount(0)

      await page.reload()
      roleARow = page.getByRole('row').filter({ hasText: warehouseAName })
      await expect(roleARow).toBeVisible({ timeout: 15_000 })
      await roleARow.getByRole('button', { name: /open actions/i }).click()
      await page.getByRole('menuitem', { name: /^Delete$/i }).click()
      const deleteResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'DELETE' &&
          response.url().includes('/api/wms/site-warehouse-roles'),
      )
      await page.getByRole('button', { name: /^Confirm$/i }).click()
      expect((await deleteResponsePromise).status()).toBe(200)
      await expect(roleARow).toHaveCount(0, { timeout: 15_000 })
    } finally {
      if (siteId) await apiRequest(request, 'PUT', '/api/wms/sites', { token: adminToken, data: { id: siteId, isActive: false } }).catch(() => undefined)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/site-warehouse-roles', roleAId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/site-warehouse-roles', roleBId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseAId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseBId)
      await restoreAdminAcl()
    }
  })

  test('renders the warehouse-role error state when the list request fails', async ({ page, request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
      'wms.view', 'wms.manage_sites',
    ])
    let siteId: string | null = null

    try {
      siteId = await createCrudFixture(request, adminToken, '/api/wms/sites', {
        code: `UIE${suffix}`, name: `Error UI ${suffix}`,
      })
      await login(page, 'admin')
      await page.route('**/api/wms/site-warehouse-roles?**', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'forced test failure' }),
        })
      })
      await page.goto(`/backend/wms/sites/${encodeURIComponent(siteId)}`)
      await expect(page.getByText(/Failed to load warehouse roles/i).first()).toBeVisible({ timeout: 15_000 })
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' })
      if (siteId) await apiRequest(request, 'PUT', '/api/wms/sites', { token: adminToken, data: { id: siteId, isActive: false } }).catch(() => undefined)
      await restoreAdminAcl()
    }
  })

  test('saves the same Site twice without reusing a stale detail version', async ({ page, request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
      'wms.view', 'wms.manage_sites',
    ])
    let siteId: string | null = null
    try {
      siteId = await createCrudFixture(request, adminToken, '/api/wms/sites', {
        code: `UIT${suffix}`, name: `Two saves ${suffix}`,
      })
      await login(page, 'admin')
      await page.goto(`/backend/wms/sites/${encodeURIComponent(siteId)}`)
      const nameInput = page.locator('[data-crud-field-id="name"] input')
      await nameInput.fill(`First browser save ${suffix}`)
      const firstRefresh = page.waitForResponse(
        (response) => response.request().method() === 'GET' && response.url().includes('/api/wms/sites?ids='),
      )
      await page.getByRole('button', { name: /Save changes/i }).first().click()
      await firstRefresh
      await expect(nameInput).toHaveValue(`First browser save ${suffix}`)
      await expectNoConflictBanner(page)

      await nameInput.fill(`Second browser save ${suffix}`)
      const secondRefresh = page.waitForResponse(
        (response) => response.request().method() === 'GET' && response.url().includes('/api/wms/sites?ids='),
      )
      await page.getByRole('button', { name: /Save changes/i }).first().click()
      await secondRefresh
      await expectNoConflictBanner(page)
      await expect.poll(async () => {
        const response = await apiRequest(request, 'GET', `/api/wms/sites?ids=${encodeURIComponent(siteId ?? '')}`, { token: adminToken })
        return (await readJsonSafe<{ items?: Array<{ name?: string }> }>(response))?.items?.[0]?.name
      }).toBe(`Second browser save ${suffix}`)
    } finally {
      if (siteId) await apiRequest(request, 'PUT', '/api/wms/sites', { token: adminToken, data: { id: siteId, isActive: false } }).catch(() => undefined)
      await restoreAdminAcl()
    }
  })
})
