import { z } from 'zod'

/**
 * Default Entra ID authority segment. `organizations` accepts work/school
 * accounts from any directory and rejects personal Microsoft accounts
 * (Outlook.com / Hotmail). Admins pin a directory (tenant) GUID or verified
 * domain to restrict consent to their own directory, or set `common` to also
 * accept personal accounts (Outlook.com uses the same Graph mail API, so the
 * adapter works unchanged). See spec D8.
 */
export const MS365_DEFAULT_TENANT = 'organizations'

/**
 * Tenant segment of the authority URL: a directory GUID, a verified domain
 * (`contoso.onmicrosoft.com`) or one of the well-known aliases. Anything else
 * would be interpolated into the login URL, so keep it to a strict charset.
 */
const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/

/**
 * Tenant-level OAuth client configuration. Stored on `IntegrationCredentials`
 * for the `ms365` provider (`integration_id = channel_ms365`, `user_id = NULL`)
 * once an admin registers the Entra app under Integrations. Per-user tokens
 * layer on top via `ms365UserCredentialsSchema`.
 */
export const ms365ClientCredentialsSchema = z
  .object({
    clientId: z.string({ error: 'OAuth Client ID required' }).min(1, 'OAuth Client ID required'),
    clientSecret: z.string({ error: 'OAuth Client Secret required' }).min(1, 'OAuth Client Secret required'),
    /** Blank falls back to `MS365_DEFAULT_TENANT` (`organizations`). */
    tenantId: z
      .string()
      .optional()
      .transform((value) => {
        const trimmed = typeof value === 'string' ? value.trim() : ''
        return trimmed.length > 0 ? trimmed : MS365_DEFAULT_TENANT
      })
      .refine((value) => TENANT_ID_PATTERN.test(value), {
        message: 'Tenant ID must be a directory GUID, a verified domain, or common / organizations / consumers',
      }),
    /** Space/comma-separated scopes; blank uses defaults. */
    scopes: z.string().optional(),
  })
  .strict()

export type Ms365ClientCredentials = z.infer<typeof ms365ClientCredentialsSchema>

/**
 * Per-user OAuth tokens stored on the per-user `IntegrationCredentials` row
 * (encrypted). The hub injects the tenant client_id / client_secret at
 * exchange/refresh time; the per-channel blob only persists the user-bound
 * tokens plus the mailbox identity.
 */
export const ms365UserCredentialsSchema = z
  .object({
    accessToken: z.string({ error: 'Access token required' }).min(1, 'Access token required'),
    /**
     * Entra issues a refresh token whenever `offline_access` is consented and
     * ROTATES it on every refresh. Optional in the schema so a legacy row that
     * never received one still parses — the runtime treats absence as
     * `requires_reauth` at the first refresh.
     */
    refreshToken: z.string().optional(),
    /** ISO timestamp of access-token expiry. */
    expiresAt: z.string().datetime().optional(),
    /** Scopes actually granted (Entra may trim what we requested). */
    scopes: z.array(z.string()).optional(),
    /** Primary SMTP address of the connected mailbox (`mail` ?? `userPrincipalName`). */
    email: z.string().email().optional(),
    /** Display name from the Graph profile. */
    displayName: z.string().optional(),
    /** Entra directory the user authenticated against (`tid` claim) — diagnostics only. */
    tenantId: z.string().optional(),
  })
  .passthrough()

export type Ms365UserCredentials = z.infer<typeof ms365UserCredentialsSchema>

/**
 * Per-channel sync state stored on `CommunicationChannel.channelState`.
 *
 *   deltaLink          — opaque Graph delta link for the Inbox; the terminal
 *                        cursor, advanced only after a full page drain.
 *   nextLink           — opaque Graph next link, present only while a
 *                        multi-page drain is in progress (mid-drain resume).
 *   receivedWatermark  — ISO `receivedDateTime` floor: delta items older than
 *                        it are flag/move updates on already-known mail and
 *                        are skipped; it is also the re-bootstrap floor after a
 *                        `410 Gone` (expired delta token). Never moves backwards.
 *   pendingWatermark   — highest `receivedDateTime` seen so far in an
 *                        in-progress multi-page drain; promoted to
 *                        `receivedWatermark` when the drain reaches a deltaLink.
 *
 * See `.ai/specs/2026-09-04-ms365-graph-email-channel.md` § Inbound sync model.
 */
export const ms365ChannelStateSchema = z
  .object({
    deltaLink: z.string().optional(),
    nextLink: z.string().optional(),
    receivedWatermark: z.string().datetime().optional(),
    pendingWatermark: z.string().datetime().optional(),
    lastSyncedAt: z.string().datetime().optional(),
  })
  .partial()
  .passthrough()

export type Ms365ChannelState = z.infer<typeof ms365ChannelStateSchema>

/** OpenID Connect scopes — always requested so we get an id_token + refresh token. */
export const MS365_OIDC_SCOPES = ['offline_access', 'openid', 'profile', 'email']

/** Graph delegated permissions the adapter needs. */
export const MS365_GRAPH_SCOPES = [
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/Mail.ReadWrite',
  'https://graph.microsoft.com/Mail.Send',
]

export const MS365_DEFAULT_SCOPES = [...MS365_OIDC_SCOPES, ...MS365_GRAPH_SCOPES]

/**
 * Parse the admin's optional scope override. `offline_access` is re-added when
 * missing because without it Entra never issues a refresh token and every
 * channel would flip to `requires_reauth` after one hour.
 */
export function parseScopes(value: string | undefined): string[] {
  if (!value || !value.trim()) return [...MS365_DEFAULT_SCOPES]
  const scopes = value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (!scopes.includes('offline_access')) scopes.unshift('offline_access')
  return Array.from(new Set(scopes))
}
