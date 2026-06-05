import { z } from 'zod'

/**
 * Tenant-level OAuth client configuration. Stored on `IntegrationCredentials`
 * for the `gmail` provider when the tenant has set up their own Google Cloud
 * project. Per-user OAuth tokens layer on top via `userCredentialsSchema`.
 */
export const gmailClientCredentialsSchema = z
  .object({
    clientId: z.string().min(1, 'OAuth Client ID required'),
    clientSecret: z.string().min(1, 'OAuth Client Secret required'),
    /** Comma-separated scopes; blank uses defaults. */
    scopes: z.string().optional(),
  })
  .strict()

export type GmailClientCredentials = z.infer<typeof gmailClientCredentialsSchema>

/**
 * Per-user OAuth tokens stored on `CommunicationChannel.credentials` (encrypted).
 * The hub injects the tenant client_id / client_secret at exchange/refresh time;
 * the per-channel blob only persists the user-bound tokens.
 */
export const gmailUserCredentialsSchema = z
  .object({
    accessToken: z.string({ error: 'Access token required' }).min(1, 'Access token required'),
    /**
     * Gmail issues a refresh token only on the first consent. If the user
     * re-authorises, Google does NOT send a new refresh token unless we pass
     * `prompt=consent` and `access_type=offline`; we always do. We still mark
     * the field optional so legacy migrations from accounts that never received
     * one don't fail the schema — the runtime treats absence as "requires_reauth".
     */
    refreshToken: z.string().optional(),
    /** ISO timestamp of access-token expiry. */
    expiresAt: z.string().datetime().optional(),
    /** Scopes that were actually granted (we may have requested a subset). */
    scopes: z.array(z.string()).optional(),
    /** Email address from the linked Google account. */
    email: z.string().email().optional(),
  })
  .passthrough()

export type GmailUserCredentials = z.infer<typeof gmailUserCredentialsSchema>

/**
 * Per-channel sync state stored on `CommunicationChannel.channelState`.
 *
 *   historyId — Gmail's per-mailbox monotonic cursor used by `history.list`
 *               to fetch only changes since the previous poll. If history has
 *               expired (Gmail keeps roughly 7 days), we fall back to a full
 *               list using `gmail.users.messages.list`.
 *
 *   pendingHistoryPageToken — mid-drain resumption state when a single tick
 *               can't ingest every page of `history.list` (e.g. a high-volume
 *               mailbox returned more than our per-tick budget). The terminal
 *               `historyId` is NOT advanced until the pages drain. The next tick
 *               resumes via the stored `historyId` + this `pageToken`.
 *
 *   pendingMessagesPageToken / pendingMessagesHistoryIdSnapshot — same
 *               contract for the 404-fallback path (`messages.list`).
 *
 * See https://developers.google.com/gmail/api/guides/sync for the contract.
 */
export const gmailChannelStateSchema = z
  .object({
    historyId: z.union([z.string(), z.number()]).optional(),
    lastSyncedAt: z.string().datetime().optional(),
    pendingHistoryPageToken: z.string().optional(),
    pendingMessagesPageToken: z.string().optional(),
    pendingMessagesHistoryIdSnapshot: z.string().optional(),
  })
  .partial()
  .passthrough()

export type GmailChannelState = z.infer<typeof gmailChannelStateSchema>

export const GMAIL_DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

export function parseScopes(value: string | undefined): string[] {
  if (!value || !value.trim()) return [...GMAIL_DEFAULT_SCOPES]
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}
