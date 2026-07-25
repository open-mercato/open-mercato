import { buildScheduledCommandContext } from '../commandContext'

describe('buildScheduledCommandContext', () => {
  it('binds organization-scoped scheduled commands to the schedule tenant and organization', () => {
    const ctx = buildScheduledCommandContext(
      {
        id: 'schedule-1',
        tenantId: 'tenant-a',
        organizationId: 'org-a',
        scopeType: 'organization',
        createdByUserId: 'user-a',
      },
      {} as Parameters<typeof buildScheduledCommandContext>[1],
    )

    expect(ctx.auth).toMatchObject({
      sub: 'user-a',
      userId: 'user-a',
      tenantId: 'tenant-a',
      orgId: 'org-a',
      isSuperAdmin: false,
    })
    expect(ctx.organizationScope).toEqual({
      selectedId: 'org-a',
      filterIds: ['org-a'],
      allowedIds: ['org-a'],
      tenantId: 'tenant-a',
    })
    expect(ctx.selectedOrganizationId).toBe('org-a')
    expect(ctx.organizationIds).toEqual(['org-a'])
  })

  it('uses a non-superadmin system actor when the schedule has no creator', () => {
    const ctx = buildScheduledCommandContext(
      {
        id: 'schedule-2',
        tenantId: 'tenant-a',
        organizationId: null,
        scopeType: 'tenant',
        createdByUserId: null,
      },
      {} as Parameters<typeof buildScheduledCommandContext>[1],
    )

    expect(ctx.auth).toMatchObject({
      sub: '00000000-0000-0000-0000-000000000000',
      userId: '00000000-0000-0000-0000-000000000000',
      tenantId: 'tenant-a',
      orgId: null,
      isSuperAdmin: false,
    })
    expect(ctx.organizationScope).toEqual({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: 'tenant-a',
    })
    expect(ctx.organizationIds).toBeNull()
  })
})
