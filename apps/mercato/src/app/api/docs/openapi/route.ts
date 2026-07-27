import { NextResponse } from 'next/server'
import { modules } from '@/.mercato/generated/modules.runtime.generated'
import { apiRoutes } from '@/.mercato/generated/api-routes.generated'
import { resolveApiDocsBaseUrl } from '@open-mercato/core/modules/api_docs/lib/resources'
import { attachOpenApiDocsToModules, buildOpenApiDocument, sanitizeOpenApiDocument } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { APP_VERSION } from '@open-mercato/shared/lib/version'

export const dynamic = 'force-dynamic'

export async function GET() {
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
  })
  const doc = sanitizeOpenApiDocument(rawDoc)
  return NextResponse.json(doc)
}
