import {
  buildSiteWarehouseRoleDefaultsListPath,
  buildSiteWarehouseRolesListPath,
  buildSiteSubmitPayload,
  SITE_WAREHOUSE_ROLES_PAGE_SIZE,
} from '../wmsSitesShared'

describe('buildSiteSubmitPayload', () => {
  it('keeps custom field values when creating a Site', () => {
    expect(
      buildSiteSubmitPayload(undefined, {
        id: 'ignored-on-create',
        code: 'MAIN',
        name: 'Main Site',
        isActive: true,
        updatedAt: null,
        cf_priority: 'high',
      }),
    ).toEqual({
      code: 'MAIN',
      name: 'Main Site',
      isActive: true,
      cf_priority: 'high',
    })
  })

  it('keeps the record version when updating a Site', () => {
    expect(
      buildSiteSubmitPayload('site-1', {
        code: 'MAIN',
        name: 'Main Site',
        isActive: true,
        updatedAt: '2026-08-28T12:00:00.000Z',
        cf_priority: 'high',
      }),
    ).toEqual({
      id: 'site-1',
      code: 'MAIN',
      name: 'Main Site',
      isActive: true,
      updatedAt: '2026-08-28T12:00:00.000Z',
      cf_priority: 'high',
    })
  })

  it('requests up to one hundred warehouse-role assignments per page', () => {
    expect(SITE_WAREHOUSE_ROLES_PAGE_SIZE).toBe(100)
    expect(
      buildSiteWarehouseRolesListPath('f5571173-37b1-4c7c-9dc1-d4ee4e475a48', 2),
    ).toBe(
      '/api/wms/site-warehouse-roles?siteId=f5571173-37b1-4c7c-9dc1-d4ee4e475a48&page=2&pageSize=100&sortField=role&sortDir=asc',
    )
  })

  it('loads all current defaults independently from the visible page', () => {
    expect(
      buildSiteWarehouseRoleDefaultsListPath(
        'f5571173-37b1-4c7c-9dc1-d4ee4e475a48',
      ),
    ).toBe(
      '/api/wms/site-warehouse-roles?siteId=f5571173-37b1-4c7c-9dc1-d4ee4e475a48&isDefault=true&page=1&pageSize=100&sortField=role&sortDir=asc',
    )
  })
})
