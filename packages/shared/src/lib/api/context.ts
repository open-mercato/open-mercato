import type { AwilixContainer } from 'awilix'
import { createRequestContainer } from '../di/container'
import { getAuthFromRequest, type AuthContext } from '../auth/server'
import { resolveTranslations } from '../i18n/server'

export type RequestContext = {
  container: AwilixContainer
  auth: AuthContext
  organizationScope?: unknown
  selectedOrganizationId?: string | null
  organizationIds?: string[] | null
  translate: (key: string, fallback?: string) => string
}

export type ResolveRequestContextResult = {
  ctx: RequestContext
}

/**
 * Resolves the request context for API routes.
 * This includes container, auth, and translations.
 * For organization-scoped routes, use resolveOrganizationScopeForRequest separately.
 */
export async function resolveRequestContext(req: Request): Promise<ResolveRequestContextResult> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()

  const ctx: RequestContext = {
    container,
    auth,
    translate,
  }

  return { ctx }
}
