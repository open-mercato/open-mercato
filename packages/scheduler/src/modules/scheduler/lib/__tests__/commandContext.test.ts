import { getAmbientCausation, runEntryWithCausation } from '@open-mercato/shared/lib/causation/server'
import {
  buildScheduleCausationFrame,
  buildScheduledCommandContext,
  resolveScheduledCommandActorUserId,
  resolveScheduledCommandCausation,
} from '../commandContext'

const container = {} as Parameters<typeof buildScheduledCommandContext>[1]

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

  it('acts as the triggering user when a manual run supplies one', () => {
    const ctx = buildScheduledCommandContext(
      {
        id: 'schedule-3',
        tenantId: 'tenant-a',
        organizationId: 'org-a',
        scopeType: 'organization',
        createdByUserId: 'user-a',
      },
      container,
      { triggeredByUserId: 'user-b' },
    )

    expect(ctx.auth).toMatchObject({ sub: 'user-b', userId: 'user-b' })
    // Only the acting identity changes: the run stays bound to the schedule's scope.
    expect(ctx.auth).toMatchObject({ tenantId: 'tenant-a', orgId: 'org-a', isSuperAdmin: false })
    expect(ctx.selectedOrganizationId).toBe('org-a')
  })

  it('falls back to the creator when an unattended run supplies no triggering user', () => {
    for (const options of [undefined, {}, { triggeredByUserId: null }, { triggeredByUserId: '   ' }]) {
      const ctx = buildScheduledCommandContext(
        {
          id: 'schedule-4',
          tenantId: 'tenant-a',
          organizationId: null,
          scopeType: 'tenant',
          createdByUserId: 'user-a',
        },
        container,
        options,
      )

      expect(ctx.auth).toMatchObject({ sub: 'user-a', userId: 'user-a' })
    }
  })

  it('falls back to the system actor when neither a triggering user nor a creator is usable', () => {
    const ctx = buildScheduledCommandContext(
      {
        id: 'schedule-5',
        tenantId: 'tenant-a',
        organizationId: null,
        scopeType: 'tenant',
        createdByUserId: null,
      },
      container,
      { triggeredByUserId: null },
    )

    expect(ctx.auth).toMatchObject({ sub: '00000000-0000-0000-0000-000000000000' })
  })
})

describe('resolveScheduledCommandActorUserId', () => {
  it('prefers the triggering user over the creator', () => {
    expect(
      resolveScheduledCommandActorUserId({ createdByUserId: 'user-a' }, { triggeredByUserId: 'user-b' }),
    ).toBe('user-b')
  })

  it('falls back to the creator', () => {
    expect(resolveScheduledCommandActorUserId({ createdByUserId: 'user-a' })).toBe('user-a')
    expect(resolveScheduledCommandActorUserId({ createdByUserId: 'user-a' }, { triggeredByUserId: null })).toBe('user-a')
  })

  it('trims and ignores blank ids', () => {
    expect(resolveScheduledCommandActorUserId({ createdByUserId: '  user-a  ' })).toBe('user-a')
    expect(
      resolveScheduledCommandActorUserId({ createdByUserId: 'user-a' }, { triggeredByUserId: '   ' }),
    ).toBe('user-a')
  })

  it('returns null rather than the system actor when no real user is available', () => {
    // The RBAC gate relies on this: it must reject an actor-less schedule with its
    // own error instead of authorizing the all-zeros system id.
    expect(resolveScheduledCommandActorUserId({ createdByUserId: null })).toBeNull()
    expect(resolveScheduledCommandActorUserId({ createdByUserId: '  ' }, { triggeredByUserId: '' })).toBeNull()
  })
})

describe('scheduled command causation', () => {
  const originalCausationFlag = process.env.OM_CAUSATION

  afterEach(() => {
    if (originalCausationFlag === undefined) delete process.env.OM_CAUSATION
    else process.env.OM_CAUSATION = originalCausationFlag
  })

  it('leaves the command context without causation when causation is disabled', () => {
    process.env.OM_CAUSATION = 'off'

    const ctx = buildScheduledCommandContext(
      { id: 'schedule-9', tenantId: 'tenant-a', organizationId: null, scopeType: 'tenant', createdByUserId: 'user-a' },
      container,
    )

    expect(ctx).not.toHaveProperty('causation')
  })

  it('reuses the ambient envelope inside the same schedule entry frame', () => {
    const { ambient, ctx } = runEntryWithCausation(buildScheduleCausationFrame('schedule-6'), () => ({
      ambient: getAmbientCausation(),
      ctx: buildScheduledCommandContext(
        { id: 'schedule-6', tenantId: 'tenant-a', organizationId: null, scopeType: 'tenant', createdByUserId: 'user-a' },
        container,
      ),
    }))

    expect(ambient!.frames).toEqual([{ kind: 'schedule', id: 'schedule-6' }])
    expect(ctx.causation).toBe(ambient)
    expect(resolveScheduledCommandCausation('schedule-6')).not.toBe(ambient)
  })

  it('creates a fresh schedule entry envelope outside a schedule frame', () => {
    const ctx = buildScheduledCommandContext(
      { id: 'schedule-7', tenantId: 'tenant-a', organizationId: null, scopeType: 'tenant', createdByUserId: 'user-a' },
      container,
    )

    expect(ctx.causation!.frames).toEqual([{ kind: 'schedule', id: 'schedule-7' }])
    expect(typeof ctx.causation!.correlationId).toBe('string')
  })

  it('never inherits an unrelated ambient envelope', () => {
    const { outer, causation } = runEntryWithCausation({ kind: 'user' }, () => ({
      outer: getAmbientCausation(),
      causation: runEntryWithCausation(buildScheduleCausationFrame('other-schedule'), () =>
        resolveScheduledCommandCausation('schedule-8'),
      ),
    }))

    expect(causation.frames).toEqual([{ kind: 'schedule', id: 'schedule-8' }])
    expect(causation.correlationId).not.toBe(outer!.correlationId)
  })
})
