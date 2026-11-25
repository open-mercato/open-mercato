import type { EntityManager } from '@mikro-orm/postgresql'
import {
  listEntityMergeParticipants,
  resetEntityMergeParticipantsForTests,
} from '@open-mercato/shared/lib/entities/merge-participants'
import { StaffTimeEntry } from '../../data/entities'
import {
  mergeStaffDealTimeEntries,
  previewStaffDealTimeEntries,
  registerStaffDealMergeParticipant,
} from '../deal-merge-participant'

const scope = {
  entityId: 'customers:customer_deal',
  survivorId: '11111111-1111-4111-8111-111111111111',
  sourceId: '22222222-2222-4222-8222-222222222222',
  tenantId: '33333333-3333-4333-8333-333333333333',
  organizationId: '44444444-4444-4444-8444-444444444444',
}

describe('staff Deal merge participant', () => {
  beforeEach(() => {
    resetEntityMergeParticipantsForTests()
  })

  it('previews scoped active time entry counts', async () => {
    const count = jest.fn(async (_entity: unknown, where: { dealId: string }) => (where.dealId === scope.sourceId ? 3 : 2))
    const em = { count } as unknown as EntityManager
    await expect(previewStaffDealTimeEntries({ ...scope, em })).resolves.toEqual({
      participantId: 'staff.deal-time-entries',
      label: 'staff.dealMerge.participantLabel',
      sourceCount: 3,
      survivorCount: 2,
      overlapCount: 0,
    })
    expect(count).toHaveBeenCalledWith(StaffTimeEntry, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      dealId: scope.sourceId,
      deletedAt: null,
    })
  })

  it('reparents every scoped source time entry to the survivor', async () => {
    const nativeUpdate = jest.fn().mockResolvedValue(4)
    const em = { nativeUpdate } as unknown as EntityManager
    await expect(mergeStaffDealTimeEntries({ ...scope, em })).resolves.toEqual({ moved: 4, deduplicated: 0 })
    expect(nativeUpdate).toHaveBeenCalledWith(StaffTimeEntry, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      dealId: scope.sourceId,
    }, { dealId: scope.survivorId, updatedAt: expect.any(Date) })
  })

  it('registers once for the Deal entity', () => {
    registerStaffDealMergeParticipant()
    registerStaffDealMergeParticipant()
    expect(listEntityMergeParticipants('customers:customer_deal').map((participant) => participant.id))
      .toEqual(['staff.deal-time-entries'])
  })
})
