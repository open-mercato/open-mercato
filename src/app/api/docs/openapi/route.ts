import { NextResponse } from 'next/server'
import { modules } from '@/generated/modules.generated'
import { buildOpenApiDocument } from '@open-mercato/shared/lib/openapi'

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
  const baseUrl = resolveBaseUrl()
  const doc = buildOpenApiDocument(modules, {
    title: 'Open Mercato API',
    version: '1.0.0',
    description: 'Auto-generated OpenAPI definition for all enabled modules.',
    servers: [{ url: baseUrl, description: 'Default environment' }],
    baseUrlForExamples: baseUrl,
    defaultSecurity: ['bearerAuth'],
  })
  return NextResponse.json(doc)
}
