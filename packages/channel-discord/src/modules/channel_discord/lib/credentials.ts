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
    // auto-reply subscriber may answer "easy" inbound messages.
    aiAutoReplyEnabled: z.boolean().optional(),
    // Agent id to invoke when AI auto-reply is enabled.
    aiAgentId: z.string().optional(),
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
