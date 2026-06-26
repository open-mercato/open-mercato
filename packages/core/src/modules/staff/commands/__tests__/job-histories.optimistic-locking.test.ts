import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { staffTeamMemberJobHistoryUpdateSchema } from '../../data/validators'

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback: string) => fallback,
  }),
}))

type RegisteredCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

async function loadCommands() {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../job-histories')
  return {
    update: commandRegistry.get('staff.team-member-job-histories.update') as RegisteredCommand,
    del: commandRegistry.get('staff.team-member-job-histories.delete') as RegisteredCommand,
  }
}

function createCtx(
  em: Pick<EntityManager, 'findOne' | 'fork'>,
  commandGuard?: { enforce: jest.Mock } | null,
) {
  return {
    auth: {
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    },
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return null
        if (name === 'commandOptimisticLockGuardService') return commandGuard ?? null
        return null
      },
    } as unknown as AwilixContainer,
    selectedOrganizationId: null,
    organizationScope: null,
    organizationIds: null,
  }
}

describe('staff job history optimistic locking', () => {
  const jobHistoryId = '123e4567-e89b-41d3-a456-426614174000'

  it('accepts non-Z updatedAt values from the list API', () => {
    expect(() =>
      staffTeamMemberJobHistoryUpdateSchema.parse({
        id: jobHistoryId,
        updatedAt: '2026-05-30T10:00:00+00:00',
      }),
    ).not.toThrow()
  })

  it('does not treat equivalent updatedAt instants as a conflict', async () => {
    const { update } = await loadCommands()
    const record = {
      id: jobHistoryId,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      updatedAt: new Date('2026-05-30T10:00:00.000Z'),
      member: { id: 'member-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      name: 'Engineer',
      companyName: null,
      description: null,
      startDate: new Date('2026-05-01T00:00:00.000Z'),
      endDate: null,
    }
    const em = {
      fork: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockResolvedValue(record),
      flush: jest.fn().mockResolvedValue(undefined),
    }

    await expect(
      update.execute(
        {
          id: jobHistoryId,
          name: 'Senior Engineer',
          updatedAt: '2026-05-30T10:00:00+00:00',
        },
        createCtx(em),
      ),
    ).resolves.toEqual({ jobHistoryId })
  })

  it('returns 409 when updating a stale job history entry', async () => {
    const { update } = await loadCommands()
    const record = {
      id: jobHistoryId,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      updatedAt: new Date('2026-05-30T10:00:00.000Z'),
      name: 'Engineer',
      member: { id: 'member-1' },
      companyName: null,
      description: null,
      startDate: new Date('2026-05-01T00:00:00.000Z'),
      endDate: null,
    }
    const em = {
      fork: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockResolvedValue(record),
    }

    await expect(
      update.execute({
        id: jobHistoryId,
        name: 'Senior Engineer',
        updatedAt: '2026-05-30T09:00:00+00:00',
      }, createCtx(em)),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({
      status: 409,
      body: { error: 'record_modified', code: 'optimistic_lock_conflict' },
    })
  })

  it('returns 409 when deleting a stale job history entry that was already removed', async () => {
    const { del } = await loadCommands()
    const em = {
      fork: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockResolvedValue(null),
    }

    await expect(
      del.execute({
        id: jobHistoryId,
        updatedAt: '2026-05-30T09:00:00.000Z',
      }, createCtx(em)),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({
      status: 409,
      body: { error: 'record_modified', code: 'optimistic_lock_conflict' },
    })
  })

  it('returns 409 when deleting a job history entry with a stale updatedAt', async () => {
    const { del } = await loadCommands()
    const record = {
      id: jobHistoryId,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      updatedAt: new Date('2026-05-30T10:00:00.000Z'),
      member: { id: 'member-1' },
      name: 'Engineer',
      companyName: null,
      description: null,
      startDate: new Date('2026-05-01T00:00:00.000Z'),
      endDate: null,
    }
    const em = {
      fork: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockResolvedValue(record),
    }

    await expect(
      del.execute({
        id: jobHistoryId,
        updatedAt: '2026-05-30T09:00:00.000Z',
      }, createCtx(em)),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({
      status: 409,
      body: { error: 'record_modified', code: 'optimistic_lock_conflict' },
    })
  })

  it('succeeds when deleting a job history entry with a matching updatedAt', async () => {
    const { del } = await loadCommands()
    const record = {
      id: jobHistoryId,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      updatedAt: new Date('2026-05-30T10:00:00.000Z'),
      member: { id: 'member-1' },
      name: 'Engineer',
      companyName: null,
      description: null,
      startDate: new Date('2026-05-01T00:00:00.000Z'),
      endDate: null,
    }
    const em = {
      fork: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockResolvedValue(record),
      remove: jest.fn().mockReturnThis(),
      flush: jest.fn().mockResolvedValue(undefined),
    }

    await expect(
      del.execute({
        id: jobHistoryId,
        updatedAt: '2026-05-30T10:00:00+00:00',
      }, createCtx(em)),
    ).resolves.toEqual({ jobHistoryId })
  })

  it('awaits the enterprise command-guard service before mutating (async seam)', async () => {
    const { update } = await loadCommands()
    const record = {
      id: jobHistoryId,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      updatedAt: new Date('2026-05-30T10:00:00.000Z'),
      member: { id: 'member-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      name: 'Engineer',
      companyName: null,
      description: null,
      startDate: new Date('2026-05-01T00:00:00.000Z'),
      endDate: null,
    }
    const em = {
      fork: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockResolvedValue(record),
      flush: jest.fn().mockResolvedValue(undefined),
    }
    const commandGuard = { enforce: jest.fn().mockResolvedValue(undefined) }

    await update.execute(
      { id: jobHistoryId, name: 'Senior Engineer', updatedAt: '2026-05-30T10:00:00.000Z' },
      createCtx(em, commandGuard),
    )

    expect(commandGuard.enforce).toHaveBeenCalledTimes(1)
    expect(commandGuard.enforce).toHaveBeenCalledWith(
      expect.objectContaining({ resourceKind: 'staff.jobHistory', resourceId: jobHistoryId }),
    )
    expect(record.name).toBe('Senior Engineer')
  })

  it('a record_lock conflict from the enterprise guard aborts the update (async seam, fail-closed)', async () => {
    const { update } = await loadCommands()
    const record = {
      id: jobHistoryId,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      updatedAt: new Date('2026-05-30T10:00:00.000Z'),
      member: { id: 'member-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      name: 'Engineer',
      companyName: null,
      description: null,
      startDate: new Date('2026-05-01T00:00:00.000Z'),
      endDate: null,
    }
    const em = {
      fork: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockResolvedValue(record),
      flush: jest.fn().mockResolvedValue(undefined),
    }
    const commandGuard = {
      enforce: jest.fn().mockRejectedValue(
        new CrudHttpError(409, { code: 'record_lock_conflict', error: 'locked by another user' }),
      ),
    }

    await expect(
      update.execute(
        { id: jobHistoryId, name: 'Senior Engineer', updatedAt: '2026-05-30T10:00:00.000Z' },
        createCtx(em, commandGuard),
      ),
    ).rejects.toMatchObject({ status: 409 })
    // The stale write must not have mutated the record before the guard rejected.
    expect(record.name).toBe('Engineer')
    expect(em.flush).not.toHaveBeenCalled()
  })
})
