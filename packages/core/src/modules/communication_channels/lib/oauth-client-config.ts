/**
 * Minimal shape of the integrations credentials service `resolve` we depend on.
 * Declared locally so this helper compiles even when the integrations module is
 * disabled in a downstream app.
 */
type CredentialsResolver = {
  resolve: (
    integrationId: string,
    scope: { tenantId: string; organizationId: string; userId?: string | null },
  ) => Promise<Record<string, unknown> | null>
}

export type OAuthClientCredentialsScope = {
  tenantId: string
  organizationId: string | null
}

/**
 * Resolve a provider's tenant-level OAuth *client application* credentials
 * (clientId / clientSecret / scopes) configured by an admin under the
 * `channel_<provider>` integration in the Integrations UI.
 *
 * Why `channel_<provider>` and NOT `oauth_<provider>`: each provider package
 * registers its OAuth client-credential fields on the `channel_<provider>`
 * integration — that is the row the admin edits and the health check reads.
 * Earlier code resolved a phantom `oauth_<provider>` id that nothing ever
 * writes, so every connect / code-exchange / refresh failed with
 * "Invalid … OAuth client credentials: expected string, received undefined"
 * even while the integration showed as configured and healthy.
 *
 * Scoping: the client app config is stored at TENANT scope (`userId = null`),
 * distinct from the per-user OAuth *tokens* that live under the SAME
 * `channel_<provider>` id at USER scope. We therefore always resolve at
 * `userId: null`, trying the caller's organization first and then the
 * organization-agnostic (`organizationId: null`) row, so a single platform /
 * tenant OAuth app can serve every organization (and so a config saved while
 * the admin had no active organization is still found).
 *
 * Returns `null` when no usable client row exists — callers MUST surface an
 * actionable "provider not configured" error instead of handing an empty
 * object to the adapter.
 */
export async function resolveOAuthClientCredentials(
  credentialsService: CredentialsResolver | null | undefined,
  providerKey: string,
  scope: OAuthClientCredentialsScope,
): Promise<Record<string, unknown> | null> {
  if (!credentialsService) return null
  const integrationId = `channel_${providerKey}`
  const organizations: Array<string | null> = [scope.organizationId, null]
  const tried = new Set<string | null>()
  for (const organizationId of organizations) {
    if (tried.has(organizationId)) continue
    tried.add(organizationId)
    let row: Record<string, unknown> | null = null
    try {
      // `organizationId` may be `null` to match the organization-agnostic row;
      // the credentials filter translates `null` into a SQL `IS NULL` match.
      row = await credentialsService.resolve(integrationId, {
        tenantId: scope.tenantId,
        organizationId: organizationId as unknown as string,
        userId: null,
      })
    } catch (resolveErr) {
      // A resolve error (e.g. a transient DB issue) for this org scope shouldn't
      // abort the lookup — fall through to the next scope — but surface it so a
      // real misconfiguration isn't silently swallowed.
      console.warn(
        '[internal] [communication_channels] resolveOAuthClientCredentials: credential resolve failed for an org scope:',
        resolveErr instanceof Error ? resolveErr.message : resolveErr,
      )
      row = null
    }
    if (row && typeof row.clientId === 'string' && row.clientId.length > 0) {
      return row
    }
  }
  return null
}
