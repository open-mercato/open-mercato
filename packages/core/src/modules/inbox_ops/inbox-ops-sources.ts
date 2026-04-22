import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type {
  InboxOpsSourceAdapter,
  InboxOpsSourceDescriptor,
  InboxOpsSourcePromptHints,
  NormalizedInboxOpsInput,
} from '@open-mercato/shared/modules/inbox-ops-sources'
import { InboxEmail, InboxSourceSubmission } from './data/entities'
import { extractParticipantsFromThread } from './lib/emailParser'
import { buildFullTextForExtraction, detectPartialForward } from './lib/source-utils'

function resolveEm(ctx: { resolve: <T = unknown>(name: string) => T }): EntityManager {
  return (ctx.resolve('em') as EntityManager).fork()
}

function buildEmailNormalizedInput(email: InboxEmail): NormalizedInboxOpsInput {
  const body = buildFullTextForExtraction(email)
  const participants = extractParticipantsFromThread(email).map((participant) => ({
    identifier: participant.email,
    displayName: participant.name || undefined,
    email: participant.email,
    role: participant.role,
  }))

  return {
    sourceEntityType: 'inbox_ops:inbox_email',
    sourceEntityId: email.id,
    sourceVersion: email.updatedAt.toISOString(),
    title: email.subject || undefined,
    body,
    bodyFormat: 'text',
    participants,
    timeline: email.threadMessages?.map((message) => ({
      timestamp: message.date,
      actorIdentifier: message.from?.email || 'unknown',
      actorLabel: message.from?.name || undefined,
      direction: 'email',
      text: message.body || '',
    })).filter((entry) => entry.text.trim().length > 0),
    capabilities: {
      canDraftReply: true,
      replyChannelType: 'email',
      canUseTimelineContext: Boolean(email.threadMessages && email.threadMessages.length > 0),
    },
    sourceMetadata: {
      subject: email.subject ?? null,
      replyTo: email.replyTo ?? null,
      messageId: email.messageId ?? null,
      references: email.emailReferences ?? [],
      forwardedByAddress: email.forwardedByAddress ?? null,
      forwardedByName: email.forwardedByName ?? null,
      isPartialForward: detectPartialForward({
        subject: email.subject,
        threadMessageCount: email.threadMessages?.length ?? 0,
      }),
    },
  }
}

function buildManualPromptHints(
  submission: InboxSourceSubmission,
): InboxOpsSourcePromptHints {
  const metadata = submission.metadata && typeof submission.metadata === 'object'
    ? submission.metadata as Record<string, unknown>
    : {}
  const sourceLabel = typeof metadata.sourceLabel === 'string' && metadata.sourceLabel.trim()
    ? metadata.sourceLabel
    : 'manual submission'
  const sourceKind = typeof metadata.sourceKind === 'string' && metadata.sourceKind.trim()
    ? metadata.sourceKind
    : 'manual text'

  return {
    sourceLabel,
    sourceKind,
    primaryEvidence: ['body'],
    participantIdentityMode: 'mixed',
    replySupport: submission.normalizedCapabilities?.canDraftReply
      ? (submission.normalizedCapabilities.replyChannelType || 'supported')
      : 'none',
  }
}

const inboxEmailSourceAdapter: InboxOpsSourceAdapter<InboxEmail> = {
  sourceEntityType: 'inbox_ops:inbox_email',
  displayKind: 'email',
  displayIcon: 'mail',
  async loadSource(args, ctx) {
    const em = resolveEm(ctx)
    const email = await findOneWithDecryption(
      em,
      InboxEmail,
      {
        id: args.sourceEntityId,
        tenantId: args.tenantId,
        organizationId: args.organizationId,
        deletedAt: null,
      },
      undefined,
      { tenantId: args.tenantId, organizationId: args.organizationId },
    )

    if (!email) {
      throw new Error(`Inbox email not found: ${args.sourceEntityId}`)
    }

    return email
  },
  getVersion(email) {
    return email.updatedAt.toISOString()
  },
  buildInput(email) {
    return buildEmailNormalizedInput(email)
  },
  buildPromptHints() {
    return {
      sourceLabel: 'email',
      sourceKind: 'email thread',
      primaryEvidence: ['timeline', 'body'],
      participantIdentityMode: 'email-first',
      replySupport: 'email',
      extraInstructions: [
        'Do not assume every email participant is the decision maker.',
        'Respect email threading and quoted context when interpreting the latest request.',
      ],
    }
  },
  buildSnapshot(email) {
    return {
      subject: email.subject ?? null,
      forwardedByAddress: email.forwardedByAddress ?? null,
      forwardedByName: email.forwardedByName ?? null,
      receivedAt: email.receivedAt.toISOString(),
      status: email.status,
      threadMessageCount: email.threadMessages?.length ?? 0,
    }
  },
}

const manualSourceSubmissionAdapter: InboxOpsSourceAdapter<InboxSourceSubmission> = {
  sourceEntityType: 'inbox_ops:source_submission',
  displayKind: 'manual',
  displayIcon: 'square-pen',
  async loadSource(args, ctx) {
    const em = resolveEm(ctx)
    const submission = await findOneWithDecryption(
      em,
      InboxSourceSubmission,
      {
        id: args.sourceEntityId,
        tenantId: args.tenantId,
        organizationId: args.organizationId,
        deletedAt: null,
      },
      undefined,
      { tenantId: args.tenantId, organizationId: args.organizationId },
    )

    if (!submission) {
      throw new Error(`Inbox source submission not found: ${args.sourceEntityId}`)
    }

    return submission
  },
  assertReady(submission) {
    if (!submission.normalizedBody || !submission.normalizedBodyFormat || !submission.normalizedCapabilities) {
      throw new Error('Manual source submission is missing normalized input')
    }
  },
  getVersion(submission, args) {
    return submission.sourceVersion ?? args.sourceVersion ?? submission.updatedAt.toISOString()
  },
  buildInput(submission) {
    return {
      sourceEntityType: submission.sourceEntityType,
      sourceEntityId: submission.sourceEntityId,
      sourceArtifactId: submission.sourceArtifactId ?? undefined,
      sourceVersion: submission.sourceVersion ?? undefined,
      title: submission.normalizedTitle ?? undefined,
      body: submission.normalizedBody || '',
      bodyFormat: submission.normalizedBodyFormat || 'text',
      participants: submission.normalizedParticipants ?? [],
      timeline: submission.normalizedTimeline ?? undefined,
      attachments: submission.normalizedAttachments ?? undefined,
      capabilities: submission.normalizedCapabilities || {
        canDraftReply: false,
        canUseTimelineContext: false,
      },
      facts: submission.facts ?? undefined,
      sourceMetadata: (submission.normalizedSourceMetadata as NormalizedInboxOpsInput['sourceMetadata']) ?? undefined,
    }
  },
  buildPromptHints(submission) {
    return buildManualPromptHints(submission)
  },
  buildSnapshot(submission) {
    return submission.sourceSnapshot ?? {
      sourceSubmissionId: submission.id,
      sourceKind: 'manual text',
    }
  },
}

export const inboxOpsSourceAdapters: InboxOpsSourceAdapter[] = [
  inboxEmailSourceAdapter,
  manualSourceSubmissionAdapter,
]
