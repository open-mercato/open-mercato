import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  attachOpenApiDocsToModules,
  buildOpenApiDocument,
  sanitizeOpenApiDocument,
} from '@open-mercato/shared/lib/openapi'
import type { OpenApiDocument } from '@open-mercato/shared/lib/openapi'
import type { ApiRouteManifestEntry, Module } from '@open-mercato/shared/modules/registry'
import { APP_VERSION } from '@open-mercato/shared/lib/version'
import { resolveApiDocsBaseUrl } from './resources'

/**
 * The exports render differently for anonymous and authenticated callers, so
 * they must never be served from a shared cache keyed on the URL alone.
 */
export const API_DOCS_CALLER_SCOPED_HEADERS = {
  'cache-control': 'no-store',
  vary: 'Cookie, Authorization',
} as const

/**
 * The Explorer renders server-side and needs the visitor's session to receive
 * the full document, but `resolveApiDocsBaseUrl()` is operator-configurable —
 * so the session cookie only travels when the export route lives on the very
 * origin that served the page.
 */
export function resolveForwardableCookieHeader(
  targetUrl: string,
  requestHeaders: Pick<Headers, 'get'>,
): string | null {
  const cookieHeader = requestHeaders.get('cookie')
  if (!cookieHeader) return null
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
  if (!host) return null
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'https'
  try {
    const target = new URL(targetUrl)
    const origin = new URL(`${protocol}://${host}`)
    return target.host === origin.host ? cookieHeader : null
  } catch {
    return null
  }
}

export type ApiDocsDocumentInput = {
  modules: Module[]
  apiRoutes: ApiRouteManifestEntry[]
  includeAccessControlMetadata: boolean
}

/**
 * The docs export routes stay publicly reachable, so the ACL metadata they
 * carry (`Requires features/roles`, `x-require-features`, `x-require-roles`)
 * is only rendered for authenticated staff callers. Anonymous callers get the
 * same document with those identifiers stripped.
 */
export async function shouldExposeAccessControlMetadata(req: Request): Promise<boolean> {
  try {
    return Boolean(await getAuthFromRequest(req))
  } catch {
    return false
  }
}

export async function buildApiDocsOpenApiDocument({
  modules,
  apiRoutes,
  includeAccessControlMetadata,
}: ApiDocsDocumentInput): Promise<OpenApiDocument> {
  const { t } = await resolveTranslations()
  const baseUrl = resolveApiDocsBaseUrl()
  const docModules = await attachOpenApiDocsToModules(modules, apiRoutes)
  const rawDoc = buildOpenApiDocument(docModules, {
    title: t('api.docs.title', 'Open Mercato API'),
    version: APP_VERSION,
    description: t('api.docs.description', 'Auto-generated OpenAPI definition for all enabled modules.'),
    servers: [{ url: baseUrl, description: t('api.docs.serverDescription', 'Default environment') }],
    baseUrlForExamples: baseUrl,
    defaultSecurity: ['bearerAuth'],
    includeAccessControlMetadata,
  })
  return sanitizeOpenApiDocument(rawDoc)
}
