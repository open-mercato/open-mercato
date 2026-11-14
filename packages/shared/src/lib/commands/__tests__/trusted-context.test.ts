import { buildTrustedCommandContext } from '@open-mercato/shared/lib/commands/trusted-context'

describe('buildTrustedCommandContext', () => {
  it('builds a system-actor context with no auth and the systemActor flag set', () => {
    const { ctx, auditMetadata } = buildTrustedCommandContext({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      actorType: 'system',
      reason: 'checkout.recovery.relock',
    })

    expect(ctx.auth).toBeNull()
    expect(ctx.systemActor).toBe(true)
    expect(ctx.organizationScope).toBeNull()
    expect(ctx.selectedOrganizationId).toBe('org-1')
    expect(ctx.organizationIds).toEqual(['org-1'])
    expect(ctx.request).toBeUndefined()

    expect(auditMetadata.tenantId).toBe('tenant-1')
    expect(auditMetadata.organizationId).toBe('org-1')
    expect(auditMetadata.actorUserId).toBeNull()
    expect(auditMetadata.context).toEqual({
      systemActor: 'system:trusted-context',
      reason: 'checkout.recovery.relock',
    })
  })

  it('builds a user-actor context attributing a real actor id without a systemActor flag', () => {
    const { ctx, auditMetadata } = buildTrustedCommandContext({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      actorType: 'user',
      actorId: 'user-42',
      reason: 'cart.proposal.re_author',
    })

    expect(ctx.auth).toEqual({ sub: 'user-42', tenantId: 'tenant-1', orgId: 'org-1' })
    expect(ctx.systemActor).toBeUndefined()
    expect(ctx.organizationScope).toBeNull()
    expect(ctx.selectedOrganizationId).toBe('org-1')
    expect(ctx.organizationIds).toEqual(['org-1'])

    expect(auditMetadata.actorUserId).toBe('user-42')
    // Still marked system-initiated: the call is not driven by this actor's own live request.
    expect(auditMetadata.context).toEqual({
      systemActor: 'system:trusted-context',
      reason: 'cart.proposal.re_author',
    })
  })

  it('throws when actorType is "user" and actorId is missing', () => {
    expect(() =>
      buildTrustedCommandContext({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        actorType: 'user',
        reason: 'cart.proposal.re_author',
      }),
    ).toThrow(/actorId/)
  })

  it('throws when tenantId, organizationId or reason are missing', () => {
    expect(() =>
      buildTrustedCommandContext({
        tenantId: '',
        organizationId: 'org-1',
        actorType: 'system',
        reason: 'x',
      }),
    ).toThrow(/tenantId/)

    expect(() =>
      buildTrustedCommandContext({
        tenantId: 'tenant-1',
        organizationId: '',
        actorType: 'system',
        reason: 'x',
      }),
    ).toThrow(/organizationId/)

    expect(() =>
      buildTrustedCommandContext({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        actorType: 'system',
        reason: '',
      }),
    ).toThrow(/reason/)
  })
})
