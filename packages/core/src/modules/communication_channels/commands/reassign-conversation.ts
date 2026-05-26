import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ChannelThreadMapping, ExternalConversation } from '../data/entities'

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
    }
  | { status: 'no_channel_link'; reason: string }
  | { status: 'noop'; reason: string }

export const COMMUNICATION_CHANNELS_REASSIGN_CONVERSATION_COMMAND_ID =
  'communication_channels.reassign_conversation'

/**
 * Reassign the owning user of a channel-linked conversation.
 *
 * Updates both `ChannelThreadMapping.assignedUserId` and the linked
 * `ExternalConversation.assignedUserId` so subscribers (notification handlers,
 * future dashboards) see a consistent owner. No external provider call —
 * reassignment is an internal-routing concern.
 *
 * Idempotent: when the new owner matches the existing one, returns `noop`.
 */
const reassignConversationCommand: CommandHandler<
  ReassignConversationInput,
  ReassignConversationResult
> = {
  id: COMMUNICATION_CHANNELS_REASSIGN_CONVERSATION_COMMAND_ID,
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
      } as any,
      undefined,
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

    const conversation = await findOneWithDecryption(
      em,
      ExternalConversation,
      {
        id: mapping.externalConversationId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      } as any,
      undefined,
      dscope,
    )
    if (!conversation) {
      return {
        status: 'no_channel_link',
        reason: `no ExternalConversation for thread ${input.threadId}`,
      }
    }

    mapping.assignedUserId = input.assignedUserId
    conversation.assignedUserId = input.assignedUserId
    await em.flush()

    return {
      status: 'reassigned',
      threadId: input.threadId,
      previousAssignedUserId,
      nextAssignedUserId: input.assignedUserId,
      conversationId: conversation.id,
    }
  },
}

registerCommand(reassignConversationCommand as unknown as CommandHandler)

export default reassignConversationCommand
