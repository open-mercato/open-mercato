import { z } from 'zod'
import { parseScopedCommandInput } from '../scoped'

const translate = (_key: string, fallback?: string) => fallback ?? _key

describe('parseScopedCommandInput', () => {
  it('preserves custom fields when parsing scoped payloads', () => {
    const schema = z.object({
      tenantId: z.string(),
      organizationId: z.string().optional(),
      name: z.string(),
    })
    const ctx = {
      auth: { tenantId: 'tenant-1', orgId: 'org-1' },
      selectedOrganizationId: 'org-1',
    } as any

    const result = parseScopedCommandInput(
      schema,
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        name: 'Test Product',
        customFields: { foo: 'bar' },
        cf_extra: '123',
      },
      ctx,
      translate
    )

    expect(result).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      name: 'Test Product',
      customFields: { foo: 'bar', extra: '123' },
    })
  })

  it('rejects a payload tenantId that does not match the actor tenant (issue #7877)', () => {
    const schema = z.object({
      tenantId: z.string(),
      organizationId: z.string().optional(),
      name: z.string(),
    })
    const ctx = {
      auth: { tenantId: 'tenant-1', orgId: 'org-1' },
      selectedOrganizationId: 'org-1',
    } as any

    expect(() =>
      parseScopedCommandInput(
        schema,
        { tenantId: 'tenant-evil', organizationId: 'org-1', name: 'Test Product' },
        ctx,
        translate
      )
    ).toThrow()
  })
})

describe('withScopedPayload', () => {
  const { withScopedPayload } = require('../scoped')
  const { CrudHttpError } = require('../../crud/errors')
  const translate = (_key: string, fallback?: string) => fallback ?? _key

  it('throws organization required even when user has global org access', () => {
    const ctx = {
      auth: { tenantId: 'tenant-1', orgId: null },
      selectedOrganizationId: null,
      organizationScope: { allowedIds: null },
    }
    expect(() => withScopedPayload({}, ctx as any, translate)).toThrow(CrudHttpError)
    try {
      withScopedPayload({}, ctx as any, translate)
    } catch (error: any) {
      expect(error).toBeInstanceOf(CrudHttpError)
      expect(error.status).toBe(400)
      expect(error.body).toEqual({ error: 'Organization context is required.' })
    }
  })

  it('succeeds when user has global org access and provides organizationId in payload', () => {
    const ctx = {
      auth: { tenantId: 'tenant-1', orgId: null },
      selectedOrganizationId: null,
      organizationScope: { allowedIds: null },
    }
    const result = withScopedPayload({ organizationId: 'org-1' }, ctx as any, translate)
    expect(result.organizationId).toBe('org-1')
    expect(result.tenantId).toBe('tenant-1')
  })

  it('succeeds when user has global org access and selectedOrganizationId is set', () => {
    const ctx = {
      auth: { tenantId: 'tenant-1', orgId: null },
      selectedOrganizationId: 'org-2',
      organizationScope: { allowedIds: null },
    }
    const result = withScopedPayload({}, ctx as any, translate)
    expect(result.organizationId).toBe('org-2')
  })

  it('rejects a non-superadmin payload tenantId that does not match the actor tenant (issue #7877)', () => {
    const ctx = {
      auth: { tenantId: 'tenant-1', orgId: 'org-1' },
      selectedOrganizationId: 'org-1',
    }
    expect(() =>
      withScopedPayload({ tenantId: 'tenant-evil' }, ctx as any, translate)
    ).toThrow(CrudHttpError)
    try {
      withScopedPayload({ tenantId: 'tenant-evil' }, ctx as any, translate)
    } catch (error: any) {
      expect(error).toBeInstanceOf(CrudHttpError)
      expect(error.status).toBe(403)
      expect(error.body).toEqual({ error: 'You are not allowed to target this tenant.' })
    }
  })

  it('rejects a non-superadmin payload tenantId when the actor has no tenant of their own', () => {
    const ctx = {
      auth: { tenantId: null, orgId: null },
      selectedOrganizationId: 'org-1',
    }
    expect(() =>
      withScopedPayload({ tenantId: 'tenant-evil', organizationId: 'org-1' }, ctx as any, translate)
    ).toThrow(CrudHttpError)
  })

  it('allows a superadmin to target a different tenantId via the payload', () => {
    const ctx = {
      auth: { tenantId: 'tenant-1', orgId: 'org-1', isSuperAdmin: true },
      selectedOrganizationId: 'org-1',
    }
    const result = withScopedPayload(
      { tenantId: 'tenant-other', organizationId: 'org-1' },
      ctx as any,
      translate
    )
    expect(result.tenantId).toBe('tenant-other')
  })

  it('succeeds when the payload tenantId matches the actor tenant explicitly', () => {
    const ctx = {
      auth: { tenantId: 'tenant-1', orgId: 'org-1' },
      selectedOrganizationId: 'org-1',
    }
    const result = withScopedPayload({ tenantId: 'tenant-1' }, ctx as any, translate)
    expect(result.tenantId).toBe('tenant-1')
  })
})
