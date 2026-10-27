/**
 * Ids shared between the AI proposal's message type, its commands, and the
 * subscriber that files it. They live in their own dependency-free module so
 * `message-types.ts` (loaded by the messages registry) and `commands/*.ts`
 * (loaded by the command bus) can agree on the strings without importing each
 * other and creating a cycle.
 *
 * Command ids are a contract surface (`BACKWARD_COMPATIBILITY.md`): renaming one
 * breaks every proposal message already sitting in an operator's inbox, because
 * the action row stored on that message still names the old id.
 */
export const CHANNEL_DISCORD_AI_PROPOSAL_APPROVE_COMMAND_ID =
  'channel_discord.ai_reply_proposal.approve'

export const CHANNEL_DISCORD_AI_PROPOSAL_DISMISS_COMMAND_ID =
  'channel_discord.ai_reply_proposal.dismiss'

/**
 * `sourceEntityType` on the proposal message. The approve command reads
 * `sourceEntityId` as the id of the inbound Discord message being answered, so
 * it can resolve the thread to reply into without trusting anything the operator
 * sends from the browser.
 */
export const CHANNEL_DISCORD_AI_PROPOSAL_SOURCE_ENTITY_TYPE = 'messages.message'
