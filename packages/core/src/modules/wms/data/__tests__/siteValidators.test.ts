import {
  SITE_MUTABLE_FIELD_REQUIRED,
  siteCreateSchema,
  siteUpdateSchema,
  siteWarehouseRoleCreateSchema,
  siteWarehouseRoleUpdateSchema,
} from '../validators'

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

describe('WMS site validators', () => {
  it('accepts a bounded, trim-safe site payload', () => {
    expect(siteCreateSchema.parse({ ...scope, code: ' pl-01 ', name: ' Plant 1 ' })).toMatchObject({ code: 'pl-01', name: 'Plant 1', isActive: true })
    expect(siteCreateSchema.parse({ ...scope, code: 'PL-02', name: 'Plant 2', isActive: false })).toMatchObject({ isActive: false })
  })

  it('rejects empty site updates and unsupported role values', () => {
    expect(() => siteUpdateSchema.parse({ id: '33333333-3333-4333-8333-333333333333' })).toThrow(
      SITE_MUTABLE_FIELD_REQUIRED,
    )
    expect(() => siteWarehouseRoleCreateSchema.parse({ ...scope, siteId: '33333333-3333-4333-8333-333333333333', warehouseId: '44444444-4444-4444-8444-444444444444', role: 'custom' })).toThrow()
  })

  it('allows only mutable assignment fields on update', () => {
    expect(siteWarehouseRoleUpdateSchema.parse({ id: '33333333-3333-4333-8333-333333333333', isDefault: true })).toEqual({ id: '33333333-3333-4333-8333-333333333333', isDefault: true })
  })

  it('accepts an update containing only custom fields', () => {
    expect(siteUpdateSchema.parse({
      id: '33333333-3333-4333-8333-333333333333',
      customFields: { priority: 'high' },
    })).toMatchObject({
      customFields: { priority: 'high' },
    })
  })

  it('rejects custom-field payload keys for warehouse-role assignments', () => {
    expect(() => siteWarehouseRoleCreateSchema.parse({
      ...scope,
      siteId: '33333333-3333-4333-8333-333333333333',
      warehouseId: '44444444-4444-4444-8444-444444444444',
      role: 'raw_material',
      cf_priority: 'high',
    })).toThrow()
  })

  it('enforces Site code and name boundaries', () => {
    expect(() => siteCreateSchema.parse({ ...scope, code: '', name: 'Plant' })).toThrow()
    expect(() => siteCreateSchema.parse({ ...scope, code: 'P'.repeat(81), name: 'Plant' })).toThrow()
    expect(() => siteCreateSchema.parse({ ...scope, code: 'P1', name: '' })).toThrow()
    expect(() => siteCreateSchema.parse({ ...scope, code: 'P1', name: 'N'.repeat(201) })).toThrow()
    expect(siteCreateSchema.parse({ ...scope, code: 'P'.repeat(80), name: 'N'.repeat(200) })).toMatchObject({
      code: 'P'.repeat(80),
      name: 'N'.repeat(200),
    })
  })

  it.each([
    'raw_material',
    'line_side',
    'wip',
    'finished_goods',
    'quarantine',
    'shipping',
  ])('accepts the fixed %s warehouse role', (role) => {
    expect(siteWarehouseRoleCreateSchema.parse({
      ...scope,
      siteId: '33333333-3333-4333-8333-333333333333',
      warehouseId: '44444444-4444-4444-8444-444444444444',
      role,
    })).toMatchObject({ role })
  })

  it('rejects immutable assignment fields and empty assignment updates', () => {
    expect(() => siteWarehouseRoleUpdateSchema.parse({
      id: '33333333-3333-4333-8333-333333333333',
      siteId: '44444444-4444-4444-8444-444444444444',
    })).toThrow()
    expect(() => siteWarehouseRoleUpdateSchema.parse({
      id: '33333333-3333-4333-8333-333333333333',
    })).toThrow()
  })
})
