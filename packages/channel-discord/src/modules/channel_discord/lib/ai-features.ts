/**
 * ACL feature ids the AI auto-reply path depends on, in one dependency-free
 * module so `acl.ts`, `ai-agents.ts`, the API routes, and the service principal
 * can all import the same literal instead of repeating the string. Feature ids
 * are FROZEN once shipped (`BACKWARD_COMPATIBILITY.md` § ACL features) — add new
 * ones rather than renaming these.
 */

/**
 * Gates invoking the Discord auto-reply agent. It grants no data access of its
 * own: the agent it unlocks runs in object mode with no tools, so the only thing
 * this feature buys its holder is the ability to have text drafted.
 *
 * It is also the single grant the subscriber's service principal falls back to
 * when a tenant has no channel-bot user — see `lib/ai-service-principal.ts`.
 */
export const CHANNEL_DISCORD_AI_AUTO_REPLY_RUN_FEATURE = 'channel_discord.ai_auto_reply.run'

/** Gates reading and writing a channel's AI auto-reply configuration. */
export const CHANNEL_DISCORD_CONFIGURE_FEATURE = 'channel_discord.configure'

/** Gates read-only access to the Discord channel configuration surfaces. */
export const CHANNEL_DISCORD_VIEW_FEATURE = 'channel_discord.view'
