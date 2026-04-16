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
