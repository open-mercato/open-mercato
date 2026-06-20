import type { ChannelCapabilities } from './adapter'

/**
 * Reaction semantics — capability-driven decisions about how the hub applies an
 * incoming or outgoing reaction.
 *
 * The platform-side `MessageReaction` table can record any number of rows per
 * (messageId, reactor); the channel-specific semantics decide whether to keep
 * existing reactions when a new one arrives:
 *
 *   - **Multi-per-user** (Slack default; `multiReactionPerUser: true`):
 *     keep all existing reactions from the same reactor; just insert the new one.
 *
 *   - **Single-per-user** (WhatsApp default; `multiReactionPerUser: false`):
 *     delete all existing reactions from the same reactor for the same message,
 *     then insert the new one. This matches WhatsApp's "one reaction per user"
 *     UI behaviour.
 *
 * The helper functions here are pure — they don't talk to the database. The
 * command layer that consumes them is responsible for the actual DELETE/INSERT.
 */

/**
 * Returns true when the channel's capabilities allow multiple reactions from
 * the same reactor on the same message (Slack-like).
 */
export function allowsMultipleReactionsPerUser(
  capabilities: Pick<ChannelCapabilities, 'multiReactionPerUser'> | null | undefined,
): boolean {
  // Default to false for safety — a missing capability declaration should not
  // accidentally enable multi-reactions. Real adapters explicitly declare both
  // booleans per SPEC-045d §1.1.
  return capabilities?.multiReactionPerUser === true
}

/**
 * Computes what mutation a new inbound `added` reaction implies, given the
 * channel's capabilities. Pure — no DB calls. The caller maps the result to
 * SQL.
 *
 * @returns `'insert'` to just persist the new reaction; `'replace'` to delete
 *   every reaction from the same reactor for the same message before inserting.
 */
export function resolveInboundAddMutation(
  capabilities: Pick<ChannelCapabilities, 'multiReactionPerUser'> | null | undefined,
): 'insert' | 'replace' {
  return allowsMultipleReactionsPerUser(capabilities) ? 'insert' : 'replace'
}
