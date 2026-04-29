import { createHash, randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type {
  InboxOpsSourceDescriptor,
  InboxOpsSourceSubmissionRequested,
  NormalizedInboxOpsInput,
} from '@open-mercato/shared/modules/inbox-ops-sources'
import { InboxSourceSubmission } from '../data/entities'
import { emitInboxOpsEvent } from '../events'

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === 'object'
      && 'code' in error
      && (error as { code?: string }).code === '23505',
  )
}

function buildSourceEventPayload(submission: InboxSourceSubmission) {
  return {
    sourceSubmissionId: submission.id,
    tenantId: submission.tenantId,
    organizationId: submission.organizationId,
    sourceEntityType: submission.sourceEntityType,
    sourceEntityId: submission.sourceEntityId,
    sourceVersion: submission.sourceVersion ?? null,
    legacyInboxEmailId: submission.legacyInboxEmailId ?? null,
  }
}

export function buildSourceDedupKey(descriptor: InboxOpsSourceDescriptor): string {
  return createHash('sha256')
    .update(JSON.stringify([
      descriptor.tenantId,
      descriptor.organizationId,
      descriptor.sourceEntityType,
      descriptor.sourceEntityId,
      descriptor.sourceArtifactId ?? '',
      descriptor.sourceVersion ?? 'v0',
    ]))
    .digest('hex')
}

export function applyNormalizedInputToSubmission(
  submission: InboxSourceSubmission,
  input: NormalizedInboxOpsInput,
): void {
  submission.normalizedTitle = input.title ?? null
  submission.normalizedBody = input.body
  submission.normalizedBodyFormat = input.bodyFormat
  submission.normalizedParticipants = input.participants
  submission.normalizedTimeline = input.timeline ?? null
  submission.normalizedAttachments = input.attachments ?? null
  submission.normalizedCapabilities = input.capabilities
  submission.facts = input.facts ?? null
  submission.normalizedSourceMetadata = input.sourceMetadata ?? null
}

export function buildDescriptorFromSubmission(
  submission: InboxSourceSubmission,
): InboxOpsSourceDescriptor {
  return {
    sourceEntityType: submission.sourceEntityType,
    sourceEntityId: submission.sourceEntityId,
    sourceArtifactId: submission.sourceArtifactId ?? undefined,
    sourceVersion: submission.sourceVersion ?? undefined,
    tenantId: submission.tenantId,
    organizationId: submission.organizationId,
    requestedByUserId: submission.requestedByUserId ?? undefined,
    triggerEventId: submission.triggerEventId ?? undefined,
  }
}

export async function submitSourceSubmission(
  em: EntityManager,
  input: InboxOpsSourceSubmissionRequested,
): Promise<{ submission: InboxSourceSubmission; created: boolean }> {
  const scope = {
    tenantId: input.descriptor.tenantId,
    organizationId: input.descriptor.organizationId,
  }
  const sourceDedupKey = buildSourceDedupKey(input.descriptor)

  const existing = await findOneWithDecryption(
    em,
    InboxSourceSubmission,
    {
      sourceDedupKey,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )

  if (existing) {
    await emitInboxOpsEvent('inbox_ops.source_submission.deduplicated', buildSourceEventPayload(existing))
    return { submission: existing, created: false }
  }

  const submission = em.create(InboxSourceSubmission, {
    id: input.submissionId ?? randomUUID(),
    sourceEntityType: input.descriptor.sourceEntityType,
    sourceEntityId: input.descriptor.sourceEntityId,
    sourceArtifactId: input.descriptor.sourceArtifactId ?? null,
    sourceVersion: input.descriptor.sourceVersion ?? null,
    sourceDedupKey,
    triggerEventId: input.descriptor.triggerEventId ?? null,
    status: 'received',
    legacyInboxEmailId: input.legacyInboxEmailId ?? null,
    requestedByUserId: input.descriptor.requestedByUserId ?? null,
    metadata: input.metadata ?? null,
    sourceSnapshot: input.initialSourceSnapshot ?? null,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })

  if (input.initialNormalizedInput) {
    applyNormalizedInputToSubmission(submission, input.initialNormalizedInput)
  }

  em.persist(submission)

  try {
    await em.flush()
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error
    }

    const deduplicated = await findOneWithDecryption(
      em,
      InboxSourceSubmission,
      {
        sourceDedupKey,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      undefined,
      scope,
    )

    if (!deduplicated) {
      throw error
    }

    await emitInboxOpsEvent('inbox_ops.source_submission.deduplicated', buildSourceEventPayload(deduplicated))
    return { submission: deduplicated, created: false }
  }

  await emitInboxOpsEvent('inbox_ops.source_submission.received', buildSourceEventPayload(submission))
  return { submission, created: true }
}
