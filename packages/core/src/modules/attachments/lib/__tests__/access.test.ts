import { checkAttachmentAccess } from '../access'

function attachment(overrides: Record<string, unknown> = {}) {
  return { tenantId: 'tenant-1', organizationId: 'org-1', ...overrides } as any
}

function partition(isPublic: boolean) {
  return { isPublic } as any
}

function auth(overrides: Record<string, unknown> = {}) {
  return { tenantId: 'tenant-1', orgId: 'org-1', roles: ['admin'], ...overrides } as any
}

describe('checkAttachmentAccess — cross-tenant public partition fix', () => {
  it('blocks unauthenticated access to tenant-scoped attachment in public partition', () => {
    const result = checkAttachmentAccess(null, attachment(), partition(true))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('allows unauthenticated access to unscoped attachment in public partition', () => {
    const result = checkAttachmentAccess(
      null,
      attachment({ tenantId: null, organizationId: null }),
      partition(true),
    )
    expect(result.ok).toBe(true)
  })

  it('allows same-tenant authenticated access in public partition', () => {
    const result = checkAttachmentAccess(auth(), attachment(), partition(true))
    expect(result.ok).toBe(true)
  })

  it('blocks cross-tenant authenticated access in public partition', () => {
    const result = checkAttachmentAccess(
      auth({ tenantId: 'other-tenant' }),
      attachment(),
      partition(true),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('blocks unauthenticated access to private partition', () => {
    const result = checkAttachmentAccess(null, attachment(), partition(false))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('allows same-tenant authenticated access in private partition', () => {
    const result = checkAttachmentAccess(auth(), attachment(), partition(false))
    expect(result.ok).toBe(true)
  })

  it('blocks cross-tenant authenticated access in private partition', () => {
    const result = checkAttachmentAccess(
      auth({ tenantId: 'other-tenant' }),
      attachment(),
      partition(false),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('allows superadmin access to any attachment in any partition', () => {
    const superAuth = auth({ isSuperAdmin: true, tenantId: 'other-tenant' })
    expect(checkAttachmentAccess(superAuth, attachment(), partition(false)).ok).toBe(true)
    expect(checkAttachmentAccess(superAuth, attachment(), partition(true)).ok).toBe(true)
  })
})

describe('checkAttachmentAccess — partial-null scope fail-closed', () => {
  it('blocks cross-org auth when attachment has tenantId set but organizationId null (private)', () => {
    const result = checkAttachmentAccess(
      auth({ tenantId: 'tenant-1', orgId: 'org-2' }),
      attachment({ tenantId: 'tenant-1', organizationId: null }),
      partition(false),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('blocks cross-tenant auth when attachment has organizationId set but tenantId null (private)', () => {
    const result = checkAttachmentAccess(
      auth({ tenantId: 'other-tenant', orgId: 'org-1' }),
      attachment({ tenantId: null, organizationId: 'org-1' }),
      partition(false),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('blocks cross-org auth when attachment has tenantId set but organizationId null (public)', () => {
    const result = checkAttachmentAccess(
      auth({ tenantId: 'tenant-1', orgId: 'org-2' }),
      attachment({ tenantId: 'tenant-1', organizationId: null }),
      partition(true),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('blocks any authenticated principal from a scoped attachment whose other column is null', () => {
    const result = checkAttachmentAccess(
      auth({ tenantId: 'tenant-1', orgId: 'org-1' }),
      attachment({ tenantId: null, organizationId: 'org-2' }),
      partition(false),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('preserves access for fully-unscoped (global) attachments to authenticated principals', () => {
    const result = checkAttachmentAccess(
      auth({ tenantId: 'tenant-1', orgId: 'org-1' }),
      attachment({ tenantId: null, organizationId: null }),
      partition(false),
    )
    expect(result.ok).toBe(true)
  })

  it('still allows same-scope auth when both attachment columns are set and match', () => {
    const result = checkAttachmentAccess(
      auth({ tenantId: 'tenant-1', orgId: 'org-1' }),
      attachment({ tenantId: 'tenant-1', organizationId: 'org-1' }),
      partition(false),
    )
    expect(result.ok).toBe(true)
  })
})
