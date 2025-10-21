import { withScopedPayload } from '../utils'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const translate = (key: string, fallback?: string) => fallback ?? key

describe('customers api utils - withScopedPayload', () => {
  it('throws when tenant context cannot be resolved', () => {
    const ctx = { auth: { tenantId: null, orgId: null }, selectedOrganizationId: null }
    expect(() => withScopedPayload(null, ctx as any, translate)).toThrow(CrudHttpError)
    try {
      withScopedPayload(null, ctx as any, translate)
    } catch (error) {
      expect(error).toBeInstanceOf(CrudHttpError)
      expect((error as CrudHttpError).status).toBe(400)
    }
  })

  it('resolves tenant and organization from context when missing in payload', () => {
    const ctx = {
      auth: { tenantId: 'tenant-1', orgId: 'auth-org' },
      selectedOrganizationId: 'selected-org',
    }
    const scoped = withScopedPayload({ name: 'Ada' }, ctx as any, translate)
    expect(scoped).toMatchObject({
      name: 'Ada',
      tenantId: 'tenant-1',
      organizationId: 'selected-org',
    })
  })

  it('prefers payload organizationId when provided', () => {
    const ctx = {
      auth: { tenantId: 'tenant-1', orgId: 'auth-org' },
      selectedOrganizationId: 'selected-org',
    }
    const scoped = withScopedPayload(
      { organizationId: 'payload-org' },
      ctx as any,
      translate
    )
    expect(scoped.organizationId).toBe('payload-org')
  })

  it('allows missing organization when explicitly disabled', () => {
    const ctx = {
      auth: { tenantId: 'tenant-1', orgId: null },
      selectedOrganizationId: null,
    }
    const scoped = withScopedPayload(
      { name: 'Grace' },
      ctx as any,
      translate,
      { requireOrganization: false }
    )
    expect(scoped).toMatchObject({
      name: 'Grace',
      tenantId: 'tenant-1',
    })
    expect(scoped).not.toHaveProperty('organizationId')
  })
})
