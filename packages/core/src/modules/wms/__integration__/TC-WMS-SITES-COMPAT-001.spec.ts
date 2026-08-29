import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getCustomFieldValue } from '@open-mercato/core/helpers/integration/crudFormFields'
import { deleteGeneralEntityIfExists, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCrudFixture, ensureRoleFeatures } from './helpers/wmsFixtures'

export const integrationMeta = { dependsOnModules: ['wms'] }

test.describe('TC-WMS-SITES-COMPAT-001: WMS Sites without Manufacturing', () => {
  test('loads WMS-only Site registrations, ACL, custom fields, and backend routes without Manufacturing', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const customFieldKey = `compat_note_${suffix}`
    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', ['wms.view', 'wms.manage_sites'])
    let siteId: string | null = null
    let warehouseId: string | null = null
    let roleId: string | null = null
    let definitionCreated = false
    try {
      const definition = await apiRequest(request, 'POST', '/api/entities/definitions', {
        token: adminToken,
        data: {
          entityId: 'wms:site',
          key: customFieldKey,
          kind: 'text',
          configJson: { label: `Compatibility note ${suffix}`, formEditable: true, listVisible: true },
        },
      })
      expect(definition.status()).toBe(200)
      definitionCreated = true

      const created = await apiRequest(request, 'POST', '/api/wms/sites', {
        token: adminToken,
        data: {
          code: `COMPAT${suffix}`,
          name: `Compatibility ${suffix}`,
          [`cf_${customFieldKey}`]: `Compatibility value ${suffix}`,
        },
      })
      expect(created.status()).toBe(201)
      siteId = (await readJsonSafe<{ id?: string }>(created))?.id ?? null
      const listed = await apiRequest(request, 'GET', `/api/wms/sites?ids=${encodeURIComponent(siteId ?? '')}`, { token: adminToken })
      expect(listed.status()).toBe(200)
      const listedSite = (await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listed))?.items?.[0] ?? null
      expect(listedSite?.id).toBe(siteId)
      expect(getCustomFieldValue(listedSite ?? {}, customFieldKey)).toBe(`Compatibility value ${suffix}`)

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `Compatibility warehouse ${suffix}`,
        code: `CMPW${suffix}`,
        city: 'Gdansk', country: 'PL', timezone: 'Europe/Warsaw', isActive: true,
      })
      roleId = await createCrudFixture(request, adminToken, '/api/wms/site-warehouse-roles', {
        siteId, warehouseId, role: 'finished_goods',
      })
      const roles = await apiRequest(
        request,
        'GET',
        `/api/wms/site-warehouse-roles?siteId=${encodeURIComponent(siteId ?? '')}&page=1&pageSize=100`,
        { token: adminToken },
      )
      expect(roles.status()).toBe(200)
      expect((await readJsonSafe<{ items?: Array<{ id?: string }> }>(roles))?.items?.some((item) => item.id === roleId)).toBe(true)

      const absentManufacturingRoute = await apiRequest(request, 'GET', '/api/manufacturing', { token: adminToken })
      expect(absentManufacturingRoute.status()).toBe(404)

      await login(page, 'admin')
      await page.goto('/backend/wms/sites')
      await expect(page.getByRole('heading', { name: /Sites/i })).toBeVisible()
      await page.goto(`/backend/wms/sites/${encodeURIComponent(siteId ?? '')}`)
      await expect(page.locator('main').getByRole('textbox').nth(0)).toHaveValue(`COMPAT${suffix.toUpperCase()}`)
    } finally {
      if (siteId) await apiRequest(request, 'PUT', '/api/wms/sites', { token: adminToken, data: { id: siteId, isActive: false } }).catch(() => undefined)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/site-warehouse-roles', roleId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      if (definitionCreated) await apiRequest(request, 'DELETE', '/api/entities/definitions', { token: adminToken, data: { entityId: 'wms:site', key: customFieldKey } }).catch(() => undefined)
      await restoreAdminAcl()
    }
  })
})
