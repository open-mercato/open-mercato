import type { MessageAction, MessageTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import {
  CHANNEL_DISCORD_AI_PROPOSAL_APPROVE_COMMAND_ID,
  CHANNEL_DISCORD_AI_PROPOSAL_DISMISS_COMMAND_ID,
} from './lib/ai-proposal-contract'

/**
 * The message type the `complex`-tier AI proposal is filed under (issue #4778).
 *
 * Declaring it here is what makes the approval surface work at all: the messages
 * module builds its allowlist of dispatchable action commands from the
 * `defaultActions` of every REGISTERED message type
 * (`messages/lib/actions.ts` → `getMessageSafeCommandIds`). An action whose
 * `commandId` is not reachable that way is rejected with "Action command is not
 * allowed" — the confused-deputy guard that stops a composer from making a
 * recipient dispatch an arbitrary command with their own auth. So the two
 * commands below are allowlisted precisely because this file declares them, and
 * for no other message type.
 */
export const CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE = 'channel_discord.ai_reply_proposal'

export const CHANNEL_DISCORD_AI_PROPOSAL_APPROVE_ACTION_ID = 'approve_send'
export const CHANNEL_DISCORD_AI_PROPOSAL_DISMISS_ACTION_ID = 'dismiss'

const proposalActions: MessageAction[] = [
  {
    id: CHANNEL_DISCORD_AI_PROPOSAL_APPROVE_ACTION_ID,
    label: 'Approve and send',
    labelKey: 'channel_discord.aiProposal.actions.approve',
    variant: 'default',
    icon: 'send',
    commandId: CHANNEL_DISCORD_AI_PROPOSAL_APPROVE_COMMAND_ID,
    isTerminal: true,
    // Sending posts publicly into a Discord server on the tenant's behalf, so the
    // operator confirms once before it leaves the building. No `confirmMessage`:
    // the inbox renders that field verbatim (`message-detail/panels/dialogs.tsx`),
    // so a translation key would leak into the dialog — omitting it falls back to
    // the module's own localized confirmation copy.
    confirmRequired: true,
  },
  {
    id: CHANNEL_DISCORD_AI_PROPOSAL_DISMISS_ACTION_ID,
    label: 'Dismiss',
    labelKey: 'channel_discord.aiProposal.actions.dismiss',
    variant: 'outline',
    icon: 'x',
    commandId: CHANNEL_DISCORD_AI_PROPOSAL_DISMISS_COMMAND_ID,
    isTerminal: true,
  },
]

export const messageTypes: MessageTypeDefinition[] = [
  {
    type: CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE,
    module: 'channel_discord',
    labelKey: 'channel_discord.aiProposal.messageType',
    icon: 'bot',
    color: 'violet',
    ui: {
      listItemComponent: 'messages.default.listItem',
      contentComponent: 'messages.default.content',
      actionsComponent: 'messages.default.actions',
    },
    // Replying to the proposal itself would go nowhere — the conversation lives
    // on the Discord thread the proposal points at, not on this internal note.
    allowReply: false,
    allowForward: true,
    defaultActions: proposalActions,
    // A week-old proposal is stale: the person on Discord has moved on and the
    // draft was written against a conversation that has since changed.
    actionsExpireAfterHours: 168,
  },
]

export default messageTypes
