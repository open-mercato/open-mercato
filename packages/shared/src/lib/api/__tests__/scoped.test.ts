import { z } from 'zod'
import { parseScopedCommandInput } from '../scoped'
import { IGNORED_FIELDS } from '../../crud/write-payload'

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

// Regression cover for the "accepted, then silently discarded" defect: a PUT that
// answers 200 while dropping part of the body. Each case asserts the field is
// either APPLIED or REPORTED — never swallowed in silence.
describe('parseScopedCommandInput write guard', () => {
  const ctx = {
    auth: { tenantId: 'tenant-1', orgId: 'org-1' },
    selectedOrganizationId: 'org-1',
  } as any

  // Mirrors dealUpdateSchema: z.object({id}).merge(dealCreateSchema.partial())
  const dealUpdateLike = z
    .object({ id: z.string() })
    .merge(
      z
        .object({
          tenantId: z.string(),
          organizationId: z.string().optional(),
          status: z.string().optional(),
          closureOutcome: z.enum(['won', 'lost']).optional(),
          lossNotes: z.string().optional(),
        })
        .partial()
    )

  it('applies snake_case keys the read endpoints emit instead of dropping them', () => {
    const result = parseScopedCommandInput(
      dealUpdateLike,
      { id: 'deal-1', status: 'closed', closure_outcome: 'lost', loss_notes: 'undercut on price' },
      ctx,
      translate
    ) as Record<string, unknown>

    expect(result.status).toBe('closed')
    expect(result.closureOutcome).toBe('lost')
    expect(result.lossNotes).toBe('undercut on price')
    expect((result as any)[IGNORED_FIELDS]).toBeUndefined()
  })

  it('reports a key it cannot write rather than answering a bare ok', () => {
    const result = parseScopedCommandInput(
      dealUpdateLike,
      { id: 'deal-1', status: 'closed', totally_made_up: 'x' },
      ctx,
      translate
    ) as Record<string, unknown>

    expect(result.status).toBe('closed')
    // Carried on a Symbol so it never lands in a command input or an audit snapshot.
    expect(result.ignoredFields).toBeUndefined()
    expect((result as any)[IGNORED_FIELDS]).toEqual([{ key: 'totally_made_up', reason: 'unknown' }])
  })

  it('rejects an unknown key outright when the caller opts into strictness', () => {
    expect(() =>
      parseScopedCommandInput(
        dealUpdateLike,
        { id: 'deal-1', totally_made_up: 'x' },
        ctx,
        translate,
        { rejectUnknownFields: true }
      )
    ).toThrow(/not writable/i)
  })

  it('rejects a real field that cannot change after creation', () => {
    expect(() =>
      parseScopedCommandInput(
        dealUpdateLike,
        { id: 'deal-1', entityId: 'entity-2' },
        ctx,
        translate,
        { immutableFields: ['entityId'] }
      )
    ).toThrow(/cannot be changed/i)
  })

  it('refuses to guess when both spellings arrive with different values', () => {
    expect(() =>
      parseScopedCommandInput(
        dealUpdateLike,
        { id: 'deal-1', closureOutcome: 'won', closure_outcome: 'lost' },
        ctx,
        translate
      )
    ).toThrow(/sent twice/i)
  })

  it('leaves custom-field keys alone', () => {
    const result = parseScopedCommandInput(
      dealUpdateLike,
      { id: 'deal-1', customFields: { foo: 'bar' }, cf_extra: '123' },
      ctx,
      translate
    ) as Record<string, unknown>

    expect(result.customFields).toEqual({ foo: 'bar', extra: '123' })
    expect((result as any)[IGNORED_FIELDS]).toBeUndefined()
  })
})
