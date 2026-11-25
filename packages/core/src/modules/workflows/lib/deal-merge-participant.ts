import type { FilterQuery } from '@mikro-orm/core'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  registerEntityMergeParticipant,
  type EntityMergeParticipantInput,
  type EntityMergeParticipantPreview,
  type EntityMergeParticipantResult,
} from '@open-mercato/shared/lib/entities/merge-participants'
import { UserTask } from '../data/entities'
import { resolveAliasedTaskEntityId } from './task-entity-aliases'

const DEAL_ENTITY_ID = 'customers:customer_deal'
const PARTICIPANT_ID = 'workflows.deal-task-bindings'
export const WORKFLOW_DEAL_MERGE_PARTICIPANT_LABEL = 'workflows.dealMerge.participantLabel'
export const WORKFLOW_DEAL_MERGE_PREVIEW_FEATURES: readonly string[] = ['workflows.tasks.view_all']

type BindingRecord = Record<string, unknown> & { entityType: string; entityId: string }

function isBindingRecord(value: unknown): value is BindingRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.entityType === 'string' && typeof record.entityId === 'string'
}

function isDealBinding(value: unknown, dealId: string): value is BindingRecord {
  return isBindingRecord(value)
    && value.entityId === dealId
    && resolveAliasedTaskEntityId(value.entityType) === DEAL_ENTITY_ID
}

function bindsDeal(task: UserTask, dealId: string): boolean {
  return (task.entityBindings ?? []).some((binding) => isDealBinding(binding, dealId))
}

async function loadTasks(input: EntityMergeParticipantInput): Promise<UserTask[]> {
  const where: FilterQuery<UserTask> = {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    $or: [input.sourceId, input.survivorId].map((entityId) => ({
      entityBindings: { $contains: [{ entityId }] },
    })),
  }
  return findWithDecryption<UserTask>(
    input.em,
    UserTask,
    where,
    { orderBy: { id: 'asc' }, disableIdentityMap: true },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
}

export async function previewWorkflowDealTaskBindings(
  input: EntityMergeParticipantInput,
): Promise<EntityMergeParticipantPreview> {
  const tasks = await loadTasks(input)
  let sourceCount = 0
  let survivorCount = 0
  let overlapCount = 0
  for (const task of tasks) {
    const source = bindsDeal(task, input.sourceId)
    const survivor = bindsDeal(task, input.survivorId)
    if (source) sourceCount += 1
    if (survivor) survivorCount += 1
    if (source && survivor) overlapCount += 1
  }
  return {
    participantId: PARTICIPANT_ID,
    label: WORKFLOW_DEAL_MERGE_PARTICIPANT_LABEL,
    sourceCount,
    survivorCount,
    overlapCount,
  }
}

function rewriteBindings(bindings: unknown[], input: EntityMergeParticipantInput) {
  let survivorBound = bindings.some((binding) => isDealBinding(binding, input.survivorId))
  const deduplicated = survivorBound
  const next: unknown[] = []
  for (const binding of bindings) {
    if (isDealBinding(binding, input.sourceId)) {
      if (survivorBound) continue
      next.push({ ...binding, entityId: input.survivorId })
      survivorBound = true
      continue
    }
    next.push(binding)
  }
  return { bindings: next, deduplicated }
}

function collectEntityTypes(bindings: unknown[]): string[] | null {
  const types = [...new Set(bindings.filter(isBindingRecord).map((binding) => binding.entityType))]
  return types.length ? types : null
}

export async function mergeWorkflowDealTaskBindings(
  input: EntityMergeParticipantInput,
): Promise<EntityMergeParticipantResult> {
  const tasks = await loadTasks(input)
  let moved = 0
  let deduplicated = 0
  for (const task of tasks) {
    if (!bindsDeal(task, input.sourceId)) continue
    const rewritten = rewriteBindings(task.entityBindings ?? [], input)
    await input.em.nativeUpdate(UserTask, {
      id: task.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    }, {
      entityBindings: rewritten.bindings.length ? rewritten.bindings : null,
      entityTypes: collectEntityTypes(rewritten.bindings),
      updatedAt: new Date(),
    })
    if (rewritten.deduplicated) deduplicated += 1
    else moved += 1
  }
  return { moved, deduplicated }
}

export function registerWorkflowDealMergeParticipant(): () => void {
  return registerEntityMergeParticipant({
    id: PARTICIPANT_ID,
    entityId: DEAL_ENTITY_ID,
    previewFeatures: WORKFLOW_DEAL_MERGE_PREVIEW_FEATURES,
    preview: previewWorkflowDealTaskBindings,
    merge: mergeWorkflowDealTaskBindings,
  })
}
