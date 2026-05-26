import { z } from 'zod'

/**
 * Tenant-level Azure AD app config. Persists on `IntegrationCredentials` for
 * the `microsoft` provider. The `tenantId` field can be a GUID, "common",
 * "organizations", or "consumers" — see Microsoft identity platform docs.
 *
 * Confidential clients provide `clientSecret`; public clients use PKCE and
 * leave it blank.
 */
export const microsoftClientCredentialsSchema = z
  .object({
    clientId: z.string().min(1, 'OAuth Client ID required'),
    tenantId: z.string().optional(),
    clientSecret: z.string().optional(),
    scopes: z.string().optional(),
  })
  .strict()

export type MicrosoftClientCredentials = z.infer<typeof microsoftClientCredentialsSchema>

/**
 * Per-user OAuth tokens on `CommunicationChannel.credentials`. Microsoft issues
 * refresh tokens by default for public clients with `offline_access`. We treat
 * `refreshToken` as required for ongoing operation; absence after a successful
 * connect indicates the scope wasn't granted.
 */
export const microsoftUserCredentialsSchema = z
  .object({
    accessToken: z.string({ error: 'Access token required' }).min(1, 'Access token required'),
    refreshToken: z.string().optional(),
    expiresAt: z.string().datetime().optional(),
    scopes: z.array(z.string()).optional(),
    email: z.string().email().optional(),
    /** Microsoft's `oid` claim — stable per-user-per-tenant id. Useful for diagnostics. */
    oid: z.string().optional(),
  })
  .passthrough()

export type MicrosoftUserCredentials = z.infer<typeof microsoftUserCredentialsSchema>

/**
 * Per-channel sync state stored on `CommunicationChannel.channelState`.
 *
 *   deltaLink — full URL returned by Microsoft Graph's last delta page; the
 *               next poll calls that URL verbatim (per Graph delta-query docs).
 *               If absent we start a fresh delta on
 *               `/me/mailFolders/inbox/messages/delta`.
 *
 *   pendingNextLink — mid-drain resumption. When Graph returns `@odata.nextLink`
 *               we walk pages up to the per-tick budget; if we can't drain in
 *               one tick we persist the current `nextLink` here and DO NOT
 *               advance `deltaLink`. The next tick resumes via this URL.
 *
 * Microsoft Graph occasionally invalidates a deltaLink and requires re-init.
 * The adapter handles this by catching `410 Gone` and falling back to a fresh
 * delta call, mirroring Gmail's history-id fallback.
 */
export const microsoftChannelStateSchema = z
  .object({
    deltaLink: z.string().url().optional(),
    pendingNextLink: z.string().url().optional(),
    lastSyncedAt: z.string().datetime().optional(),
  })
  .partial()
  .passthrough()

export type MicrosoftChannelState = z.infer<typeof microsoftChannelStateSchema>

export const MICROSOFT_DEFAULT_SCOPES = [
  'offline_access',
  'Mail.Read',
  'Mail.Send',
  'Mail.ReadWrite',
  'User.Read',
]

export function parseScopes(value: string | undefined): string[] {
  if (!value || !value.trim()) return [...MICROSOFT_DEFAULT_SCOPES]
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function resolveAuthority(tenantId: string | undefined): string {
  const t = (tenantId ?? 'common').trim()
  return t.length > 0 ? t : 'common'
}
