import { z } from 'zod'

/**
 * Discord bot channel credentials (SPEC 2026-06-19 § Data models).
 *
 * The hub persists this blob inside `IntegrationCredentials.credentials`
 * (encrypted at rest, scope `channel_discord`). Never log any value — the bot
 * token grants full control of the bot user.
 *
 * `.passthrough()` (not `.strict()`) so the connect-credential-channel command
 * can stash bookkeeping fields (e.g. `userId`) alongside the entered credentials,
 * mirroring the IMAP provider.
 */
export const discordCredentialsSchema = z
  .object({
    // "Bot <token>" — used as `Authorization: Bot <token>` on every REST call and
    // for the gateway Identify handshake. Never logged.
    botToken: z.string().min(1, 'Bot token required'),
    // Application (client) id — needed to register slash commands + build invites.
    applicationId: z.string().min(1, 'Application ID required'),
    // Ed25519 public key (hex) from the application's General Information tab —
    // verifies signed interaction requests. Never used as a secret; safe to store.
    publicKey: z
      .string()
      .min(1, 'Public key required')
      .regex(/^[0-9a-fA-F]+$/, 'Public key must be hex')
      .refine((value) => value.length === 64, 'Public key must be a 32-byte (64 hex char) Ed25519 key'),
    // Scope the bot to one guild (recommended). Optional.
    guildId: z.string().optional(),
    // Default outbound text channel id (used by the test-send smoke test).
    defaultChannelId: z.string().optional(),
  })
  .passthrough()

export type DiscordCredentials = z.infer<typeof discordCredentialsSchema>

/**
 * Gateway resume state persisted on `CommunicationChannel.channelState` (JSONB,
 * additive) so the worker can `RESUME` instead of re-`IDENTIFY` after a
 * disconnect. Discord requires the stored `resumeGatewayUrl` + `sessionId` +
 * last `sequence` to resume a session.
 */
export const discordChannelStateSchema = z
  .object({
    sessionId: z.string().optional(),
    sequence: z.number().nullable().optional(),
    resumeGatewayUrl: z.string().optional(),
    // Bot's own user id — cached after the READY event so the worker can drop
    // events it authored (feedback-loop guard) without an extra REST call.
    botUserId: z.string().optional(),
    lastConnectedAt: z.string().optional(),
    // Per-channel AI auto-reply toggle (default OFF). When truthy, the AI
    // auto-reply subscriber may answer "easy" inbound messages and proposes a
    // reply for everything else. Written by the channel's AI auto-reply settings
    // form via `PUT /api/channel_discord/channels/{id}/ai-auto-reply`.
    aiAutoReplyEnabled: z.boolean().optional(),
    // Object-mode agent id invoked when auto-reply is enabled. Defaults to the
    // provider's own `channel_discord.auto_reply` agent; a tenant may point it at
    // any object-mode agent whose `requiredFeatures` its channel-bot user holds.
    aiAgentId: z.string().optional(),
    // Why the last auto-reply attempt produced nothing, cleared by the next
    // attempt that gets somewhere. The settings route validates a channel's agent
    // against the auto-reply principal before arming it, but a role edit after the
    // fact can still make the runtime start denying the call — and the subscriber
    // degrades to a no-op by design, because a broken model must never become a
    // send. Without a persisted marker that leaves an "Auto-reply on" channel
    // answering nothing with nothing for an operator to look at. Written only by
    // `lib/channel-state-store.ts`, never by the subscriber directly.
    aiAutoReplyLastError: z.string().optional(),
    // When the *current* failure was first observed. A channel that keeps failing
    // for the same reason does not rewrite the row on every inbound message, so
    // this is a first-seen stamp rather than a last-attempt one — the alternative
    // is a row update per message on exactly the channels already misbehaving.
    aiAutoReplyLastErrorAt: z.string().optional(),
  })
  .partial()
  .passthrough()

export type DiscordChannelState = z.infer<typeof discordChannelStateSchema>

export function parseDiscordCredentialsOrThrow(value: unknown): DiscordCredentials {
  const parsed = discordCredentialsSchema.safeParse(value)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(`[internal] Invalid Discord credentials: ${first?.message ?? 'unknown validation error'}`)
  }
  return parsed.data
}
