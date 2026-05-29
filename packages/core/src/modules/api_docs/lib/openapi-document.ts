import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { buildOpenApiDocument, sanitizeOpenApiDocument } from '@open-mercato/shared/lib/openapi'
import type { OpenApiDocument } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { APP_VERSION } from '@open-mercato/shared/lib/version'
import { resolveApiDocsBaseUrl } from './resources'

export async function buildSanitizedApiDocsOpenApiDocument(): Promise<OpenApiDocument> {
  const { t } = await resolveTranslations()
  const baseUrl = resolveApiDocsBaseUrl()
  const rawDoc = buildOpenApiDocument(getModules(), {
    title: t('api.docs.title', 'Open Mercato API'),
    version: APP_VERSION,
    description: t('api.docs.description', 'Auto-generated OpenAPI definition for all enabled modules.'),
    servers: [{ url: baseUrl, description: t('api.docs.serverDescription', 'Default environment') }],
    baseUrlForExamples: baseUrl,
    defaultSecurity: ['bearerAuth'],
  })
  return sanitizeOpenApiDocument(rawDoc)
}
