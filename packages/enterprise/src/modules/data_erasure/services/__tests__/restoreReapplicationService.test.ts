import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { PrivacyGovernanceService } from '../governanceService'
import { PrivacyRestoreReapplicationService } from '../restoreReapplicationService'

describe('PrivacyRestoreReapplicationService', () => {
  it('reapplies bounded manifest entries with their original scope and data classes', async () => {
    const runSubjectRequest = jest.fn(async () => ({
      operation: { id: 'operation-1', status: 'completed' as const },
    }))
    const service = new PrivacyRestoreReapplicationService(
      { runSubjectRequest } as unknown as PrivacyGovernanceService,
      () => ({
        listAfter: async () => [{
          requestId: 'request-1',
          tenantId: 'tenant-1',
          organizationId: 'organization-1',
          subjectKind: 'auth:user',
          subjectId: 'user-1',
          dataClassIds: ['auth.users'],
          executedAt: '2026-08-24T10:00:00.000Z',
        }],
      }),
    )
    const context = { container: {} } as CommandRuntimeContext

    const result = await service.reapply({
      after: new Date('2026-08-24T09:00:00.000Z'),
      actorId: 'actor-1',
      dryRun: false,
      maxEntries: 100,
      offset: 0,
      commandContext: context,
    })

    expect(runSubjectRequest).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', organizationId: 'organization-1' },
      'actor-1',
      {
        action: 'erase',
        subject: { kind: 'auth:user', id: 'user-1' },
        dataClassIds: ['auth.users'],
        dryRun: false,
      },
      expect.objectContaining({
        auth: null,
        selectedOrganizationId: 'organization-1',
        organizationIds: ['organization-1'],
        systemActor: true,
      }),
      { skipManifest: true },
    )
    expect(result).toEqual(expect.objectContaining({
      totalPending: 1,
      processed: 1,
      completed: 1,
      continuationRequired: false,
    }))
  })

  it('limits one run and reports when another batch is required', async () => {
    const runSubjectRequest = jest.fn(async () => ({
      operation: { id: 'operation-1', status: 'blocked' as const },
    }))
    const entries = [1, 2].map((index) => ({
      requestId: `request-${index}`,
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      subjectKind: 'auth:user',
      subjectId: `user-${index}`,
      executedAt: `2026-08-24T10:00:0${index}.000Z`,
    }))
    const service = new PrivacyRestoreReapplicationService(
      { runSubjectRequest } as unknown as PrivacyGovernanceService,
      () => ({ listAfter: async () => entries }),
    )

    const result = await service.reapply({
      after: new Date('2026-08-24T09:00:00.000Z'),
      actorId: 'actor-1',
      dryRun: true,
      maxEntries: 1,
      offset: 0,
      commandContext: { container: {} } as CommandRuntimeContext,
    })

    expect(runSubjectRequest).toHaveBeenCalledTimes(1)
    expect(result).toEqual(expect.objectContaining({
      totalPending: 2,
      processed: 1,
      blocked: 1,
      nextOffset: 1,
      continuationRequired: true,
    }))
  })
})
