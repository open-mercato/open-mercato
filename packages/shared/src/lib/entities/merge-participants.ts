import type { EntityManager } from '@mikro-orm/postgresql'

export type EntityMergeScope = {
  tenantId: string
  organizationId: string
}

export type EntityMergeCallerFeatureCheck = (required: readonly string[]) => Promise<boolean>

export type EntityMergeParticipantInput = EntityMergeScope & {
  em: EntityManager
  entityId: string
  survivorId: string
  sourceId: string
  callerHasFeatures?: EntityMergeCallerFeatureCheck
}

export type EntityMergeParticipantPreview = {
  participantId: string
  label: string
  sourceCount: number
  survivorCount: number
  overlapCount: number
}

export type EntityMergeParticipantResult = {
  moved: number
  deduplicated: number
}

export type EntityMergeParticipant = {
  id: string
  entityId: string
  previewFeatures?: readonly string[]
  preview?: (input: EntityMergeParticipantInput) => Promise<EntityMergeParticipantPreview>
  merge: (input: EntityMergeParticipantInput) => Promise<EntityMergeParticipantResult>
}

const REGISTRY_KEY = '__openMercatoEntityMergeParticipants__'

function registry(): Map<string, EntityMergeParticipant> {
  const scope = globalThis as Record<string, unknown>
  const current = scope[REGISTRY_KEY]
  if (current instanceof Map) return current as Map<string, EntityMergeParticipant>
  const created = new Map<string, EntityMergeParticipant>()
  scope[REGISTRY_KEY] = created
  return created
}

function participantKey(entityId: string, participantId: string): string {
  return `${entityId}\u0000${participantId}`
}

export function registerEntityMergeParticipant(participant: EntityMergeParticipant): () => void {
  const key = participantKey(participant.entityId, participant.id)
  registry().set(key, participant)
  return () => {
    if (registry().get(key) === participant) registry().delete(key)
  }
}

export function listEntityMergeParticipants(entityId: string): readonly EntityMergeParticipant[] {
  return Array.from(registry().values())
    .filter((participant) => participant.entityId === entityId)
    .sort((left, right) => left.id.localeCompare(right.id))
}

export async function canPreviewEntityMergeParticipant(
  participant: EntityMergeParticipant,
  input: Pick<EntityMergeParticipantInput, 'callerHasFeatures'>,
): Promise<boolean> {
  if (!participant.preview) return false
  const required = participant.previewFeatures ?? []
  if (required.length === 0) return true
  if (!input.callerHasFeatures) return false
  return input.callerHasFeatures(required)
}

export async function collectEntityMergeParticipantPreviews(
  input: EntityMergeParticipantInput,
): Promise<EntityMergeParticipantPreview[]> {
  const previews = await Promise.all(listEntityMergeParticipants(input.entityId).map(async (participant) => {
    if (!participant.preview) return null
    if (!(await canPreviewEntityMergeParticipant(participant, input))) return null
    return participant.preview(input)
  }))
  return previews.filter((preview): preview is EntityMergeParticipantPreview => preview !== null)
}

export function resetEntityMergeParticipantsForTests(): void {
  registry().clear()
}
