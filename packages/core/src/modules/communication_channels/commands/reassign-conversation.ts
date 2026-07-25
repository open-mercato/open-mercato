import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload as extractSharedUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ChannelThreadMapping, ExternalConversation } from '../data/entities'
import { emitCommunicationChannelsEvent } from '../events'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('communication_channels').child({ component: 'reassign-conversation' })

const reassignConversationSchema = z.object({
  threadId: z.string().uuid(),
  /** Set to `null` to unassign the conversation. */
  assignedUserId: z.string().uuid().nullable(),
  scope: z.object({
    tenantId: z.string().uuid(),
    organizationId: z.string().uuid().nullable(),
  }),
})

export type ReassignConversationInput = z.infer<typeof reassignConversationSchema>

export type ReassignConversationResult =
  | {
      status: 'reassigned'
      threadId: string
      previousAssignedUserId: string | null
      nextAssignedUserId: string | null
      conversationId: string
      undo: ReassignConversationUndoSnapshot
    }
  | { status: 'no_channel_link'; reason: string }
  | { status: 'invalid_assignee'; reason: string }
  | { status: 'noop'; reason: string }

export interface ReassignConversationUndoSnapshot {
  threadMappingId: string
  conversationId: string
  // Optional for backward compatibility with log entries written before tenant
  // scoping was added to the undo lookup; new snapshots always set it.
  tenantId?: string
  previousAssignedUserId: string | null
  newAssignedUserId: string | null
}

export const COMMUNICATION_CHANNELS_REASSIGN_CONVERSATION_COMMAND_ID =
  'communication_channels.conversation.reassign'

/**
 * Reassign the owning user of a channel-linked conversation.
 *
 * Updates both `ChannelThreadMapping.assignedUserId` and the linked
 * `ExternalConversation.assignedUserId` so subscribers (notification handlers,
 * future dashboards) see a consistent owner. No external provider call —
 * reassignment is an internal-routing concern.
 *
 * Idempotent: when the new owner matches the existing one, returns `noop`.
 *
 * The command is undoable: the `before` snapshot captures the previous owner on
 * both rows so undo can restore them atomically.
 */
const reassignConversationCommand: CommandHandler<
  ReassignConversationInput,
  ReassignConversationResult
> = {
  id: COMMUNICATION_CHANNELS_REASSIGN_CONVERSATION_COMMAND_ID,
  // Explicitly undoable (the bus also infers this from `undo` below, but
  // declaring it keeps undoability from silently dropping under a refactor).
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = reassignConversationSchema.parse(rawInput) as ReassignConversationInput
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const dscope = {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
    }

    const mapping = await findOneWithDecryption(
      em,
      ChannelThreadMapping,
      {
        messageThreadId: input.threadId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      },
      // `message_thread_id` is non-unique (only `(external_conversation_id,
      // tenant_id)` is unique). The 1:1 thread↔mapping invariant holds in v1,
      // but order deterministically so a future many-conversations-per-thread
      // merge can never resolve an arbitrary mapping here.
      { orderBy: { createdAt: 'asc' } },
      dscope,
    )
    if (!mapping) {
      return {
        status: 'no_channel_link',
        reason: `no ChannelThreadMapping for thread ${input.threadId}`,
      }
    }

    const previousAssignedUserId = mapping.assignedUserId ?? null
    if (previousAssignedUserId === input.assignedUserId) {
      return { status: 'noop', reason: 'assigned user unchanged' }
    }

    // Reject an assignee that is not a live user of this tenant — a UUID-shaped
    // body alone must not create a cross-tenant / dangling owner reference.
    if (input.assignedUserId) {
      // Reference the `auth` user row by string entity name so this command does
      // not import the auth module's entities (module independence); `as never`
      // matches the codebase pattern for cross-module decrypted reads.
      const assignee = await findOneWithDecryption(
        em,
        'User' as never,
        { id: input.assignedUserId, tenantId: input.scope.tenantId, deletedAt: null } as never,
        undefined,
        dscope,
      )
      if (!assignee) {
        return {
          status: 'invalid_assignee',
          reason: 'assigned user is not a member of this tenant',
        }
      }
    }

    const conversation = await findOneWithDecryption(
      em,
      ExternalConversation,
      {
        id: mapping.externalConversationId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      },
      undefined,
      dscope,
    )
    if (!conversation) {
      return {
        status: 'no_channel_link',
        reason: `no ExternalConversation for thread ${input.threadId}`,
      }
    }

    // `assignedUserId` is an advisory routing pointer, not a DB foreign key
    // (modules don't share ORM relations). The assignee-existence check above
    // and this write are not atomic, so a user deleted in between leaves a
    // harmless dangling pointer — consistent with the module's no-FK design.
    mapping.assignedUserId = input.assignedUserId
    conversation.assignedUserId = input.assignedUserId
    await em.flush()

    try {
      await emitCommunicationChannelsEvent(
        'communication_channels.conversation.reassigned',
        {
          conversationId: conversation.id,
          channelId: mapping.channelId,
          messageThreadId: input.threadId,
          previousAssignedUserId,
          assignedUserId: input.assignedUserId,
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId ?? null,
        },
        { persistent: true },
      )
    } catch (emitErr) {
      // Best-effort lifecycle/workflow-trigger signal — a bus failure must not
      // abort the reassignment (the rows are already committed above).
      logger.warn(
        'reassigned event emit failed',
        { err: emitErr },
      )
    }

    const undo: ReassignConversationUndoSnapshot = {
      threadMappingId: mapping.id,
      conversationId: conversation.id,
      tenantId: mapping.tenantId,
      previousAssignedUserId,
      newAssignedUserId: input.assignedUserId,
    }

    return {
      status: 'reassigned',
      threadId: input.threadId,
      previousAssignedUserId,
      nextAssignedUserId: input.assignedUserId,
      conversationId: conversation.id,
      undo,
    }
  },
  // Persist the undo snapshot into the action log. Without this, the command bus
  // mints an undo token (so the UI offers "Undo") but the snapshot returned from
  // execute() is never stored, and undo() would silently no-op.
  async buildLog({ input, result }) {
    if (result.status !== 'reassigned') return null
    return {
      resourceKind: 'communication_channels.channel',
      resourceId: result.conversationId,
      tenantId: result.undo.tenantId ?? input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
      payload: { undo: result.undo },
      snapshotBefore: result.undo,
    }
  },
  async undo({ ctx, logEntry }) {
    const snapshot = extractSnapshotFromLog(logEntry)
    if (!snapshot) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    // Never resolve by bare id (cross-tenant). New snapshots always carry
    // tenantId; refuse the undo if a legacy snapshot lacks it.
    if (!snapshot.tenantId) return
    const dscope = { tenantId: snapshot.tenantId, organizationId: null }

    const mapping = await findOneWithDecryption(
      em,
      ChannelThreadMapping,
      { id: snapshot.threadMappingId, tenantId: snapshot.tenantId },
      undefined,
      dscope,
    )
    const conversation = await findOneWithDecryption(
      em,
      ExternalConversation,
      { id: snapshot.conversationId, tenantId: snapshot.tenantId },
      undefined,
      dscope,
    )
    if (mapping) mapping.assignedUserId = snapshot.previousAssignedUserId
    if (conversation) conversation.assignedUserId = snapshot.previousAssignedUserId
    if (mapping || conversation) await em.flush()
  },
}

/**
 * Read the undo payload defensively — wraps the shared
 * `@open-mercato/shared/lib/commands/undo.ts` helper with a narrow-by-shape
 * validation so callers get a strongly-typed snapshot or `null`.
 *
 * Kept as a separate export for test ergonomics (tests can mock the snapshot
 * shape directly without round-tripping through a CommandLogEntry).
 */
export function extractUndoPayload(value: unknown): ReassignConversationUndoSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as { undo?: unknown }).undo ?? value
  if (!candidate || typeof candidate !== 'object') return null
  const obj = candidate as Record<string, unknown>
  if (typeof obj.threadMappingId !== 'string' || typeof obj.conversationId !== 'string') return null
  return {
    threadMappingId: obj.threadMappingId,
    conversationId: obj.conversationId,
    tenantId: typeof obj.tenantId === 'string' ? obj.tenantId : undefined,
    previousAssignedUserId:
      typeof obj.previousAssignedUserId === 'string' ? obj.previousAssignedUserId : null,
    newAssignedUserId: typeof obj.newAssignedUserId === 'string' ? obj.newAssignedUserId : null,
  }
}

/**
 * Pulls the reassignment snapshot from a command log entry — first via the
 * shared `extractUndoPayload` helper, then through the local shape-validator.
 * Always falls back to `null` so the undo handler can no-op safely.
 */
export function extractSnapshotFromLog(logEntry: unknown): ReassignConversationUndoSnapshot | null {
  const undo = extractSharedUndoPayload<ReassignConversationUndoSnapshot>(
    (logEntry ?? null) as never,
  )
  if (undo) return extractUndoPayload(undo)
  return extractUndoPayload(logEntry)
}

registerCommand(reassignConversationCommand)

export default reassignConversationCommand
