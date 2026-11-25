import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  registerEntityMergeParticipant,
  type EntityMergeParticipantInput,
  type EntityMergeParticipantPreview,
  type EntityMergeParticipantResult,
} from '@open-mercato/shared/lib/entities/merge-participants'
import { Message, MessageObject } from '../data/entities'

const DEAL_ENTITY_ID = 'customers:customer_deal'
const DEAL_OBJECT_MODULE = 'customers'
const DEAL_OBJECT_TYPE = 'deal'
const PARTICIPANT_ID = 'messages.deal-objects'
export const MESSAGE_DEAL_MERGE_PARTICIPANT_LABEL = 'messages.dealMerge.participantLabel'
export const MESSAGE_DEAL_MERGE_PREVIEW_FEATURES: readonly string[] = ['messages.manage']

async function loadScopedObjects(input: EntityMergeParticipantInput): Promise<MessageObject[]> {
  const objects = await findWithDecryption(
    input.em,
    MessageObject,
    {
      entityModule: DEAL_OBJECT_MODULE,
      entityType: DEAL_OBJECT_TYPE,
      entityId: { $in: [input.survivorId, input.sourceId] },
    },
    { orderBy: { id: 'asc' }, disableIdentityMap: true },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
  if (objects.length === 0) return []
  const messageIds = [...new Set(objects.map((object) => object.messageId))]
  const messages = await findWithDecryption(
    input.em,
    Message,
    {
      id: { $in: messageIds },
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    },
    { fields: ['id'], disableIdentityMap: true },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
  const scopedMessageIds = new Set(messages.map((message) => message.id))
  return objects.filter((object) => scopedMessageIds.has(object.messageId))
}

function groupByMessage(objects: MessageObject[], input: EntityMergeParticipantInput) {
  const groups = new Map<string, { source: MessageObject[]; survivor: MessageObject[] }>()
  for (const object of objects) {
    const group = groups.get(object.messageId) ?? { source: [], survivor: [] }
    if (object.entityId === input.sourceId) group.source.push(object)
    else if (object.entityId === input.survivorId) group.survivor.push(object)
    groups.set(object.messageId, group)
  }
  return groups
}

export async function previewMessageDealObjects(
  input: EntityMergeParticipantInput,
): Promise<EntityMergeParticipantPreview> {
  const groups = groupByMessage(await loadScopedObjects(input), input)
  let sourceCount = 0
  let survivorCount = 0
  let overlapCount = 0
  for (const group of groups.values()) {
    if (group.source.length) sourceCount += 1
    if (group.survivor.length) survivorCount += 1
    if (group.source.length && group.survivor.length) overlapCount += 1
  }
  return {
    participantId: PARTICIPANT_ID,
    label: MESSAGE_DEAL_MERGE_PARTICIPANT_LABEL,
    sourceCount,
    survivorCount,
    overlapCount,
  }
}

export async function mergeMessageDealObjects(
  input: EntityMergeParticipantInput,
): Promise<EntityMergeParticipantResult> {
  const groups = groupByMessage(await loadScopedObjects(input), input)
  let moved = 0
  let deduplicated = 0
  for (const group of groups.values()) {
    if (group.source.length === 0) continue
    const candidates = [...group.survivor, ...group.source]
    const keeper = candidates.find((object) => object.actionRequired) ?? candidates[0]
    for (const object of candidates) {
      if (object.id === keeper.id) continue
      await input.em.nativeDelete(MessageObject, { id: object.id, messageId: object.messageId })
      if (object.entityId === input.sourceId) deduplicated += 1
    }
    if (keeper.entityId === input.sourceId) {
      await input.em.nativeUpdate(MessageObject, {
        id: keeper.id,
        messageId: keeper.messageId,
        entityId: input.sourceId,
      }, { entityId: input.survivorId })
      if (group.survivor.length) deduplicated += 1
      else moved += 1
    }
  }
  return { moved, deduplicated }
}

export function registerMessageDealMergeParticipant(): () => void {
  return registerEntityMergeParticipant({
    id: PARTICIPANT_ID,
    entityId: DEAL_ENTITY_ID,
    previewFeatures: MESSAGE_DEAL_MERGE_PREVIEW_FEATURES,
    preview: previewMessageDealObjects,
    merge: mergeMessageDealObjects,
  })
}
