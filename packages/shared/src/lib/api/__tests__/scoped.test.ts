import { z } from 'zod'
import { parseScopedCommandInput, withScopedPayload, type ScopedContext } from '../scoped'

const translate = (_key: string, fallback?: string) => fallback ?? _key

const tenantId = 'tenant-1'
const selectedOrganizationId = 'org-1'
const otherOrganizationId = 'org-2'

function scopedContext(allowedIds: string[] | null): ScopedContext {
  return {
    auth: { sub: 'actor-1', tenantId, orgId: selectedOrganizationId },
    container: {} as ScopedContext['container'],
    organizationScope: { tenantId, selectedId: selectedOrganizationId, allowedIds, filterIds: [selectedOrganizationId] },
    selectedOrganizationId,
    organizationIds: [selectedOrganizationId],
  }
}

describe('scoped payload organization authorization', () => {
  const payload = { organizationId: otherOrganizationId }
  const forbidden = expect.objectContaining({ status: 403 })

  it('uses the authorized organization set for explicit targets', () => {
    const ctx = scopedContext([selectedOrganizationId, otherOrganizationId])

    expect(withScopedPayload(payload, ctx, translate)).toEqual({ tenantId, ...payload })
    expect(withScopedPayload({}, ctx, translate)).toEqual({ tenantId, organizationId: selectedOrganizationId })
  })

  it('enforces the organization grant before parsing command input', () => {
    const ctx = scopedContext([selectedOrganizationId])
    const schema = z.object({ organizationId: z.string() })

    expect(() => parseScopedCommandInput(schema, payload, ctx, translate)).toThrow(forbidden)
  })

  it('honors a resolved unrestricted grant and an explicit superadmin', () => {
    expect(withScopedPayload(payload, scopedContext(null), translate)).toEqual({ tenantId, ...payload })
    const superadmin = scopedContext([])
    if (superadmin.auth) superadmin.auth.isSuperAdmin = true
    expect(withScopedPayload(payload, superadmin, translate)).toEqual({ tenantId, ...payload })
  })

  it('rejects explicitly empty and tenantless resolved scopes', () => {
    const ctx = scopedContext([])
    expect(() => withScopedPayload({ organizationId: selectedOrganizationId }, ctx, translate)).toThrow(forbidden)

    const tenantless = { ...ctx, organizationScope: { allowedIds: null, tenantId: null, selectedId: null, filterIds: null } }
    expect(() => withScopedPayload(payload, tenantless, translate)).toThrow(forbidden)
  })

  it('allows omitted organization for tenant-only payloads and still checks a supplied target', () => {
    const ctx = { ...scopedContext([]), auth: { sub: 'actor-1', tenantId, orgId: null }, selectedOrganizationId: null }
    const options = { requireOrganization: false }

    expect(withScopedPayload({}, ctx, translate, options)).toEqual({ tenantId })
    expect(() => withScopedPayload(payload, ctx, translate, options)).toThrow(forbidden)
  })

  it('fails closed on an HTTP request missing all trusted organization context', () => {
    const ctx = {
      ...scopedContext(null),
      auth: { sub: 'actor-1', tenantId, orgId: null },
      selectedOrganizationId: null,
      organizationScope: null,
      organizationIds: null,
      request: new Request('https://example.test'),
    }

    expect(() => withScopedPayload(payload, ctx, translate)).toThrow(forbidden)
    expect(() => withScopedPayload({}, ctx, translate)).toThrow(expect.objectContaining({ status: 400 }))
  })

  it('preserves the legacy fallback for a trusted scope-null command context', () => {
    const ctx = { ...scopedContext(null), organizationScope: null, systemActor: true }

    expect(withScopedPayload({ organizationId: selectedOrganizationId }, ctx, translate)).toEqual({
      tenantId,
      organizationId: selectedOrganizationId,
    })
    expect(() => withScopedPayload(payload, ctx, translate)).toThrow(forbidden)
  })
})

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
      organizationScope: { tenantId: 'tenant-1', allowedIds: null },
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
