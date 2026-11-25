import {
  registerEntityMergeParticipant,
  type EntityMergeParticipantInput,
  type EntityMergeParticipantPreview,
  type EntityMergeParticipantResult,
} from '@open-mercato/shared/lib/entities/merge-participants'
import { StaffTimeEntry } from '../data/entities'

const DEAL_ENTITY_ID = 'customers:customer_deal'
const PARTICIPANT_ID = 'staff.deal-time-entries'
export const STAFF_DEAL_MERGE_PARTICIPANT_LABEL = 'staff.dealMerge.participantLabel'
export const STAFF_DEAL_MERGE_PREVIEW_FEATURES: readonly string[] = ['staff.timesheets.manage_all']

function countEntries(input: EntityMergeParticipantInput, dealId: string): Promise<number> {
  return input.em.count(StaffTimeEntry, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    dealId,
    deletedAt: null,
  })
}

export async function previewStaffDealTimeEntries(
  input: EntityMergeParticipantInput,
): Promise<EntityMergeParticipantPreview> {
  const [sourceCount, survivorCount] = await Promise.all([
    countEntries(input, input.sourceId),
    countEntries(input, input.survivorId),
  ])
  return {
    participantId: PARTICIPANT_ID,
    label: STAFF_DEAL_MERGE_PARTICIPANT_LABEL,
    sourceCount,
    survivorCount,
    overlapCount: 0,
  }
}

export async function mergeStaffDealTimeEntries(
  input: EntityMergeParticipantInput,
): Promise<EntityMergeParticipantResult> {
  const moved = await input.em.nativeUpdate(StaffTimeEntry, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    dealId: input.sourceId,
  }, { dealId: input.survivorId, updatedAt: new Date() })
  return { moved, deduplicated: 0 }
}

export function registerStaffDealMergeParticipant(): () => void {
  return registerEntityMergeParticipant({
    id: PARTICIPANT_ID,
    entityId: DEAL_ENTITY_ID,
    previewFeatures: STAFF_DEAL_MERGE_PREVIEW_FEATURES,
    preview: previewStaffDealTimeEntries,
    merge: mergeStaffDealTimeEntries,
  })
}
