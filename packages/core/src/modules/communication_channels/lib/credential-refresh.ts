import type {
  ChannelAdapter,
  OAuthClientConfig,
  RefreshedCredentials,
  TenantScope,
} from './adapter'

/**
 * Optional credentials-service shape — matches the integrations module's
 * `CredentialsService`. We keep this loose so the helper compiles even when
 * the integrations module is disabled in a downstream app (the helper just
 * skips persistence in that case).
 */
/**
 * Matches the real `CredentialsService.save(integrationId, credentials, scope)`
 * signature from `packages/core/src/modules/integrations/lib/credentials-service.ts`.
 * The legacy call sites had this argument order inverted; that bug was the root
 * cause of C1 in the 2026-05-26 review.
 *
 * `scope.userId` (added 2026-05-26 for per-user channels) lets the credentials
 * service write to a user-scoped row instead of overwriting the tenant-wide row.
 */
type CredentialsScope = TenantScope & { userId?: string | null }
type CredentialsServiceLike = {
  resolve: (integrationId: string, scope: CredentialsScope) => Promise<Record<string, unknown> | null>
  save?: (integrationId: string, credentials: Record<string, unknown>, scope: CredentialsScope) => Promise<void>
}

export type RefreshCredentialsIfNeededInput = {
  adapter: ChannelAdapter
  channelId: string
  /** Current decrypted credential blob. May contain `expiresAt` (Date or ISO string). */
  credentials: Record<string, unknown>
  scope: CredentialsScope
  /** Refresh window — refresh when token expires within this many ms. Defaults to 60s. */
  refreshWindowMs?: number
  /** Force a refresh regardless of expiry — used after a 401 response from the provider. */
  force?: boolean
}

export type RefreshCredentialsIfNeededResult = {
  refreshed: boolean
  /** The latest credential blob to use for the outbound call. */
  credentials: Record<string, unknown>
}

const DEFAULT_REFRESH_WINDOW_MS = 60_000

/**
 * Refresh OAuth credentials when an access token is near expiry, or when the
 * caller forces it (e.g. after a 401 response).
 *
 * Behaviour:
 *   - No-op when the adapter does not implement `refreshCredentials?`.
 *   - No-op when the credential blob has no `expiresAt` AND `force !== true`.
 *   - Returns the refreshed credentials in-memory; persistence to
 *     `integration_credentials` happens via the `CredentialsService` if it
 *     is registered AND exposes `save()` (best-effort — failures are logged
 *     but don't block the outbound call).
 */
export async function refreshCredentialsIfNeeded(
  input: RefreshCredentialsIfNeededInput,
  deps?: { credentialsService?: CredentialsServiceLike | null; logger?: (...args: unknown[]) => void },
): Promise<RefreshCredentialsIfNeededResult> {
  const log = deps?.logger ?? (() => {})
  if (typeof input.adapter.refreshCredentials !== 'function') {
    return { refreshed: false, credentials: input.credentials }
  }

  const refreshWindow = input.refreshWindowMs ?? DEFAULT_REFRESH_WINDOW_MS
  if (!input.force && !shouldRefresh(input.credentials, refreshWindow)) {
    return { refreshed: false, credentials: input.credentials }
  }

  // Resolve the tenant's OAuth client config (clientId/clientSecret/tenantId)
  // from `integration_credentials.scope = oauth_<providerKey>`. The adapter
  // uses this for the token-endpoint call. Without it, OAuth providers
  // (Gmail, Microsoft) fall back to the deprecated `credentials._client`
  // path, which no production caller populates — see Spec A
  // (.ai/specs/2026-05-27-oauth-refresh-credentials-client-wiring-fix.md).
  let oauthClient: OAuthClientConfig | undefined
  if (deps?.credentialsService) {
    try {
      const raw = await deps.credentialsService.resolve(
        `oauth_${input.adapter.providerKey}`,
        input.scope,
      )
      oauthClient = safeParseOAuthClient(raw)
    } catch (resolveErr) {
      log(
        '[communication_channels] resolving OAuth client config failed:',
        resolveErr instanceof Error ? resolveErr.message : resolveErr,
      )
    }
  }

  let result: RefreshedCredentials
  try {
    result = await input.adapter.refreshCredentials({
      channelId: input.channelId,
      credentials: input.credentials,
      scope: input.scope,
      oauthClient,
    })
  } catch (err) {
    log('[communication_channels] refreshCredentials failed:', err instanceof Error ? err.message : err)
    // Return current credentials — caller may still attempt the send with the old token.
    return { refreshed: false, credentials: input.credentials }
  }

  const next = result?.credentials ?? input.credentials
  if (deps?.credentialsService?.save) {
    try {
      await deps.credentialsService.save(
        `channel_${input.adapter.providerKey}`,
        result.expiresAt ? { ...next, expiresAt: result.expiresAt.toISOString() } : next,
        input.scope,
      )
    } catch (saveErr) {
      log('[communication_channels] persisting refreshed credentials failed:', saveErr instanceof Error ? saveErr.message : saveErr)
    }
  }

  return { refreshed: true, credentials: next }
}

function shouldRefresh(credentials: Record<string, unknown>, windowMs: number): boolean {
  const expiresAtRaw = credentials?.expiresAt
  if (!expiresAtRaw) return false
  const expiresAt = parseExpiresAt(expiresAtRaw)
  if (!expiresAt) return false
  return expiresAt.getTime() - Date.now() <= windowMs
}

function parseExpiresAt(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw : null
  if (typeof raw === 'string' || typeof raw === 'number') {
    const date = new Date(raw)
    return Number.isFinite(date.getTime()) ? date : null
  }
  return null
}

/**
 * Parse a raw `oauth_<provider>` credential row into the `OAuthClientConfig`
 * shape adapters expect. Returns `undefined` when the row is missing or
 * malformed — adapters then fall back to the deprecated `credentials._client`
 * read path (one minor-release deprecation per Spec A).
 */
function safeParseOAuthClient(raw: unknown): OAuthClientConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const clientId = typeof record.clientId === 'string' ? record.clientId : undefined
  if (!clientId) return undefined
  const clientSecret =
    typeof record.clientSecret === 'string' ? record.clientSecret : undefined
  const tenantId = typeof record.tenantId === 'string' ? record.tenantId : undefined
  const scopes = Array.isArray(record.scopes)
    ? record.scopes.filter((value): value is string => typeof value === 'string')
    : undefined
  return {
    clientId,
    ...(clientSecret !== undefined ? { clientSecret } : {}),
    ...(tenantId !== undefined ? { tenantId } : {}),
    ...(scopes !== undefined ? { scopes } : {}),
  }
}
