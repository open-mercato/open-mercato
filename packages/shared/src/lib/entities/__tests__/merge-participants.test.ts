import type { EntityManager } from '@mikro-orm/postgresql'
import {
  canPreviewEntityMergeParticipant,
  collectEntityMergeParticipantPreviews,
  listEntityMergeParticipants,
  registerEntityMergeParticipant,
  resetEntityMergeParticipantsForTests,
} from '../merge-participants'

describe('entity merge participant registry', () => {
  beforeEach(() => resetEntityMergeParticipantsForTests())

  const participant = (id: string, entityId = 'customers:customer_deal') => ({
    id,
    entityId,
    merge: jest.fn(async () => ({ moved: 0, deduplicated: 0 })),
  })

  it('orders participants deterministically and isolates entity ids', () => {
    registerEntityMergeParticipant(participant('z'))
    registerEntityMergeParticipant(participant('a'))
    registerEntityMergeParticipant(participant('other', 'customers:customer_entity'))
    expect(listEntityMergeParticipants('customers:customer_deal').map(({ id }) => id)).toEqual(['a', 'z'])
  })

  it('replaces duplicate registrations and unregisters only the current value', () => {
    const first = participant('documents')
    const second = participant('documents')
    const unregisterFirst = registerEntityMergeParticipant(first)
    const unregisterSecond = registerEntityMergeParticipant(second)
    unregisterFirst()
    expect(listEntityMergeParticipants(first.entityId)).toEqual([second])
    unregisterSecond()
    expect(listEntityMergeParticipants(first.entityId)).toEqual([])
  })

  describe('collectEntityMergeParticipantPreviews', () => {
    const entityId = 'customers:customer_deal'
    const baseInput = {
      em: {} as EntityManager,
      entityId,
      survivorId: 'survivor',
      sourceId: 'source',
      tenantId: 'tenant',
      organizationId: 'org',
    }
    const previewing = (id: string, previewFeatures?: readonly string[]) => {
      const preview = jest.fn(async () => ({ participantId: id, label: id, sourceCount: 1, survivorCount: 2, overlapCount: 0 }))
      return { ...participant(id, entityId), previewFeatures, preview }
    }

    it('returns previews only for participants whose features the caller holds', async () => {
      const open = previewing('open')
      const granted = previewing('granted', ['granted.view'])
      const denied = previewing('denied', ['denied.view'])
      registerEntityMergeParticipant(open)
      registerEntityMergeParticipant(granted)
      registerEntityMergeParticipant(denied)
      registerEntityMergeParticipant(participant('merge-only', entityId))
      const callerHasFeatures = jest.fn(async (required: readonly string[]) => required.every((feature) => feature === 'granted.view'))

      const previews = await collectEntityMergeParticipantPreviews({ ...baseInput, callerHasFeatures })

      expect(previews.map(({ participantId }) => participantId)).toEqual(['granted', 'open'])
      expect(denied.preview).not.toHaveBeenCalled()
      expect(callerHasFeatures).toHaveBeenCalledWith(['denied.view'])
      expect(callerHasFeatures).toHaveBeenCalledWith(['granted.view'])
    })

    it('fails closed for feature-gated participants when no caller check is supplied', async () => {
      const gated = previewing('gated', ['gated.view'])
      registerEntityMergeParticipant(gated)
      registerEntityMergeParticipant(previewing('open'))

      const previews = await collectEntityMergeParticipantPreviews(baseInput)

      expect(previews.map(({ participantId }) => participantId)).toEqual(['open'])
      expect(gated.preview).not.toHaveBeenCalled()
      await expect(canPreviewEntityMergeParticipant(gated, {})).resolves.toBe(false)
    })
  })
})
