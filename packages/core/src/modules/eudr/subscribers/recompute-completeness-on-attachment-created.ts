import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { EudrEvidenceSubmission, EudrPlot } from '../data/entities'
import { computeSubmissionCompleteness } from '../lib/completeness'

const EVIDENCE_SUBMISSION_ENTITY_ID = 'eudr:eudr_evidence_submission'

export const metadata = {
  event: 'attachments.attachment.created',
  persistent: false,
  id: 'eudr:attachment-created-completeness',
}

type AttachmentCountDatabase = {
  attachments: {
    entity_id: string
    record_id: string
    tenant_id: string | null
    organization_id: string | null
  }
}

type AttachmentEventPayload = {
  entityId?: unknown
  recordId?: unknown
  tenantId?: unknown
  organizationId?: unknown
}

type ScopedAttachmentPayload = {
  recordId: string
  tenantId: string
  organizationId: string
}

type EventBusLike = {
  emitEvent(
    eventName: string,
    payload: Record<string, unknown>,
    options?: { tenantId?: string | null; organizationId?: string | null },
  ): Promise<void> | void
}

export type AttachmentSubscriberContext = {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve<T = unknown>(name: string): T }
}

function parsePayload(payload: AttachmentEventPayload): ScopedAttachmentPayload | null {
  if (payload.entityId !== EVIDENCE_SUBMISSION_ENTITY_ID) return null
  if (typeof payload.recordId !== 'string' || payload.recordId.trim().length === 0) return null
  if (typeof payload.tenantId !== 'string' || payload.tenantId.trim().length === 0) return null
  if (typeof payload.organizationId !== 'string' || payload.organizationId.trim().length === 0) return null
  return {
    recordId: payload.recordId,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  }
}

function parseCountValue(value: string | number | bigint | null | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

async function countLinkedAttachments(
  em: EntityManager,
  scope: ScopedAttachmentPayload,
): Promise<number | undefined> {
  try {
    const db = em.getKysely<AttachmentCountDatabase>()
    const row = await db
      .selectFrom('attachments')
      .select(sql<string | number | bigint>`count(*)`.as('attachment_count'))
      .where('entity_id', '=', EVIDENCE_SUBMISSION_ENTITY_ID)
      .where('record_id', '=', scope.recordId)
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', '=', scope.organizationId)
      .executeTakeFirst()
    return parseCountValue(row?.attachment_count)
  } catch {
    return undefined
  }
}

async function countActivePlots(
  em: EntityManager,
  submission: EudrEvidenceSubmission,
): Promise<number> {
  const plotIds = Array.from(new Set(Array.isArray(submission.plotIds) ? submission.plotIds : []))
  if (plotIds.length === 0) return 0
  return em.count(EudrPlot, {
    id: { $in: plotIds },
    tenantId: submission.tenantId,
    organizationId: submission.organizationId,
    deletedAt: null,
    isActive: true,
  })
}

async function emitSubmissionReindex(
  ctx: AttachmentSubscriberContext,
  submission: EudrEvidenceSubmission,
): Promise<void> {
  const bus = ctx.resolve<EventBusLike>('eventBus')
  await bus.emitEvent(
    'query_index.upsert_one',
    {
      entityType: EVIDENCE_SUBMISSION_ENTITY_ID,
      recordId: submission.id,
      organizationId: submission.organizationId,
      tenantId: submission.tenantId,
      crudAction: 'updated',
    },
    {
      organizationId: submission.organizationId,
      tenantId: submission.tenantId,
    },
  )
}

export async function recomputeSubmissionCompletenessFromAttachmentPayload(
  payload: AttachmentEventPayload,
  ctx: AttachmentSubscriberContext,
): Promise<void> {
  const scopedPayload = parsePayload(payload)
  if (!scopedPayload) return

  const baseEm = ctx.resolve<EntityManager>('em')
  const em = baseEm.fork()
  const submission = await findOneWithDecryption(
    em,
    EudrEvidenceSubmission,
    {
      id: scopedPayload.recordId,
      tenantId: scopedPayload.tenantId,
      organizationId: scopedPayload.organizationId,
      deletedAt: null,
    },
    undefined,
    {
      tenantId: scopedPayload.tenantId,
      organizationId: scopedPayload.organizationId,
    },
  )
  if (!submission) return

  const [activePlotCount, linkedAttachmentCount] = await Promise.all([
    countActivePlots(em, submission),
    countLinkedAttachments(em, scopedPayload),
  ])
  const completeness = computeSubmissionCompleteness({
    originCountry: submission.originCountry ?? null,
    geolocation: submission.geolocation ?? null,
    quantityKg: submission.quantityKg ?? null,
    harvestFrom: submission.harvestFrom ?? null,
    harvestTo: submission.harvestTo ?? null,
    producerName: submission.producerName ?? null,
    attachmentIds: submission.attachmentIds ?? [],
  }, {
    activePlotCount,
    linkedAttachmentCount,
  })
  submission.completenessScore = completeness.score
  submission.missingFields = [...completeness.missingFields]
  // Projection update only: attachment CRUD already owns the undoable write.
  await em.flush()
  await emitSubmissionReindex(ctx, submission)
}

export default async function handleAttachmentCreated(
  payload: AttachmentEventPayload,
  ctx: AttachmentSubscriberContext,
): Promise<void> {
  try {
    await recomputeSubmissionCompletenessFromAttachmentPayload(payload, ctx)
  } catch (error) {
    console.warn('[eudr] attachment-created completeness recompute failed', error)
  }
}
