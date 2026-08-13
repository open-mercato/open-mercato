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
