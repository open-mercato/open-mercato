import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  registerEntityMergeParticipant,
  type EntityMergeParticipantInput,
  type EntityMergeParticipantPreview,
  type EntityMergeParticipantResult,
} from '@open-mercato/shared/lib/entities/merge-participants'
import { Attachment } from '../data/entities'
import { mergeAttachmentMetadata, readAttachmentMetadata, type AttachmentAssignment } from './metadata'

const DEAL_ENTITY_ID = 'customers:customer_deal'
const PARTICIPANT_ID = 'attachments.deal-records'
export const ATTACHMENT_DEAL_MERGE_PARTICIPANT_LABEL = 'attachments.dealMerge.participantLabel'
export const ATTACHMENT_DEAL_MERGE_PREVIEW_FEATURES: readonly string[] = ['attachments.view']

const REFERENCING_ATTACHMENT_IDS_SQL = [
  'select id from attachments',
  'where tenant_id = ? and organization_id = ?',
  'and ((entity_id = ? and record_id in (?, ?))',
  "or storage_metadata -> 'assignments' @> ?::jsonb",
  "or storage_metadata -> 'assignments' @> ?::jsonb)",
].join(' ')

type AttachmentReference = {
  attachment: Attachment
  assignments: AttachmentAssignment[]
  referencesSource: boolean
  referencesSurvivor: boolean
}

function assignmentFilter(recordId: string): string {
  return JSON.stringify([{ type: DEAL_ENTITY_ID, id: recordId }])
}

function referencesDeal(attachment: Attachment, assignments: AttachmentAssignment[], dealId: string): boolean {
  if (attachment.entityId === DEAL_ENTITY_ID && attachment.recordId === dealId) return true
  return assignments.some((assignment) => assignment.type === DEAL_ENTITY_ID && assignment.id === dealId)
}

async function loadReferences(
  input: EntityMergeParticipantInput,
  options: { lockRows: boolean },
): Promise<AttachmentReference[]> {
  const sql = options.lockRows ? `${REFERENCING_ATTACHMENT_IDS_SQL} order by id for update` : REFERENCING_ATTACHMENT_IDS_SQL
  const rows = await input.em.execute(sql, [
    input.tenantId,
    input.organizationId,
    DEAL_ENTITY_ID,
    input.survivorId,
    input.sourceId,
    assignmentFilter(input.survivorId),
    assignmentFilter(input.sourceId),
  ])
  const ids = (Array.isArray(rows) ? rows : [])
    .map((row) => (row && typeof row === 'object' ? (row as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === 'string')
  if (ids.length === 0) return []
  const attachments = await findWithDecryption(
    input.em,
    Attachment,
    { id: { $in: ids }, tenantId: input.tenantId, organizationId: input.organizationId },
    { orderBy: { id: 'asc' }, disableIdentityMap: true },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
  return attachments.map((attachment) => {
    const assignments = readAttachmentMetadata(attachment.storageMetadata).assignments ?? []
    return {
      attachment,
      assignments,
      referencesSource: referencesDeal(attachment, assignments, input.sourceId),
      referencesSurvivor: referencesDeal(attachment, assignments, input.survivorId),
    }
  })
}

export async function previewAttachmentDealRecords(
  input: EntityMergeParticipantInput,
): Promise<EntityMergeParticipantPreview> {
  const references = await loadReferences(input, { lockRows: false })
  return {
    participantId: PARTICIPANT_ID,
    label: ATTACHMENT_DEAL_MERGE_PARTICIPANT_LABEL,
    sourceCount: references.filter((reference) => reference.referencesSource).length,
    survivorCount: references.filter((reference) => reference.referencesSurvivor).length,
    overlapCount: references.filter((reference) => reference.referencesSource && reference.referencesSurvivor).length,
  }
}

export async function mergeAttachmentDealRecords(
  input: EntityMergeParticipantInput,
): Promise<EntityMergeParticipantResult> {
  const references = await loadReferences(input, { lockRows: true })
  let moved = 0
  let deduplicated = 0
  const rewrites: Array<{ id: string; storageMetadata: string }> = []
  for (const reference of references) {
    if (!reference.referencesSource) continue
    const { attachment } = reference
    const assignments = reference.assignments.map((assignment) => (
      assignment.type === DEAL_ENTITY_ID && assignment.id === input.sourceId
        ? { ...assignment, id: input.survivorId }
        : assignment
    ))
    const storageMetadata = mergeAttachmentMetadata(attachment.storageMetadata, { assignments })
    rewrites.push({ id: attachment.id, storageMetadata: JSON.stringify(storageMetadata) })
    if (reference.referencesSurvivor) deduplicated += 1
    else moved += 1
  }
  for (let offset = 0; offset < rewrites.length; offset += ATTACHMENT_REWRITE_CHUNK_SIZE) {
    const chunk = rewrites.slice(offset, offset + ATTACHMENT_REWRITE_CHUNK_SIZE)
    await input.em.execute(buildAttachmentRewriteSql(chunk.length), [
      DEAL_ENTITY_ID,
      input.sourceId,
      input.survivorId,
      ...chunk.flatMap((rewrite) => [rewrite.id, rewrite.storageMetadata]),
      input.tenantId,
      input.organizationId,
    ])
  }
  return { moved, deduplicated }
}

export const ATTACHMENT_REWRITE_CHUNK_SIZE = 500

function buildAttachmentRewriteSql(rowCount: number): string {
  const values = Array.from({ length: rowCount }, () => '(?::uuid, ?::jsonb)').join(', ')
  return [
    'update attachments as a',
    'set storage_metadata = v.storage_metadata,',
    'record_id = case when a.entity_id = ? and a.record_id = ? then ? else a.record_id end',
    `from (values ${values}) as v(id, storage_metadata)`,
    'where a.id = v.id and a.tenant_id = ? and a.organization_id = ?',
  ].join(' ')
}

export function registerAttachmentDealMergeParticipant(): () => void {
  return registerEntityMergeParticipant({
    id: PARTICIPANT_ID,
    entityId: DEAL_ENTITY_ID,
    previewFeatures: ATTACHMENT_DEAL_MERGE_PREVIEW_FEATURES,
    preview: previewAttachmentDealRecords,
    merge: mergeAttachmentDealRecords,
  })
}
