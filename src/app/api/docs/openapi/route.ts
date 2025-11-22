import { NextResponse } from 'next/server'
import { modules } from '@/generated/modules.generated'
import { buildOpenApiDocument, sanitizeOpenApiDocument } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const dynamic = 'force-dynamic'

function resolveBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'http://localhost:3000'
  )
}

export async function GET() {
  const { t } = await resolveTranslations()
  const baseUrl = resolveBaseUrl()
  const rawDoc = buildOpenApiDocument(modules, {
    title: t('api.docs.title', 'Open Mercato API'),
    version: '1.0.0',
    description: t('api.docs.description', 'Auto-generated OpenAPI definition for all enabled modules.'),
    servers: [{ url: baseUrl, description: t('api.docs.serverDescription', 'Default environment') }],
    baseUrlForExamples: baseUrl,
    defaultSecurity: ['bearerAuth'],
  })
  const doc = sanitizeOpenApiDocument(rawDoc)
  return NextResponse.json(doc)
}
