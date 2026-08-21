import { resolveCustomerDetailTenantScope } from '../detailTenantScope'

const RECORD_ID = '123e4567-e89b-41d3-a456-426614174000'
const TENANT_ID = '123e4567-e89b-41d3-a456-426614174010'

describe('resolveCustomerDetailTenantScope', () => {
  it('injects the caller tenant into the WHERE clause for a tenant-bound principal', () => {
    const result = resolveCustomerDetailTenantScope(RECORD_ID, 'company', {
      tenantId: TENANT_ID,
      isSuperAdmin: false,
    })

    expect(result.allowed).toBe(true)
    expect(result.where).toEqual({
      id: RECORD_ID,
      kind: 'company',
      deletedAt: null,
      tenantId: TENANT_ID,
    })
  })

  it('denies a non-super-admin principal whose tenantId is null (issue #2695)', () => {
    const result = resolveCustomerDetailTenantScope(RECORD_ID, 'company', {
      tenantId: null,
      isSuperAdmin: false,
    })

    expect(result.allowed).toBe(false)
    expect(result.where).toBeNull()
  })

  it('denies a null-tenant principal when isSuperAdmin is undefined', () => {
    const result = resolveCustomerDetailTenantScope(RECORD_ID, 'person', {
      tenantId: null,
    })

    expect(result.allowed).toBe(false)
    expect(result.where).toBeNull()
  })

  it('allows a super-admin with no tenant scope to read without a tenant filter', () => {
    const result = resolveCustomerDetailTenantScope(RECORD_ID, 'person', {
      tenantId: null,
      isSuperAdmin: true,
    })

    expect(result.allowed).toBe(true)
    expect(result.where).toEqual({
      id: RECORD_ID,
      kind: 'person',
      deletedAt: null,
    })
    expect((result.where as Record<string, unknown>).tenantId).toBeUndefined()
  })

  it('still scopes by tenant for a super-admin who has an active tenant binding', () => {
    const result = resolveCustomerDetailTenantScope(RECORD_ID, 'company', {
      tenantId: TENANT_ID,
      isSuperAdmin: true,
    })

    expect(result.allowed).toBe(true)
    expect(result.where).toEqual({
      id: RECORD_ID,
      kind: 'company',
      deletedAt: null,
      tenantId: TENANT_ID,
    })
  })
})
