import { NextResponse } from 'next/server'
import { modules } from '@/.mercato/generated/modules.generated'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveApiDocsBaseUrl } from '@open-mercato/core/modules/api_docs/lib/resources'
import { buildOpenApiDocument, generateMarkdownFromOpenApi, sanitizeOpenApiDocument } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { APP_VERSION } from '@open-mercato/shared/lib/version'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const rbacService = container.resolve('rbacService') as RbacService
  const hasAccess =
    auth.isSuperAdmin === true ||
    await rbacService.userHasAllFeatures(auth.sub, ['api_docs.view'], {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })
  if (!hasAccess) {
    return NextResponse.json({ ok: false, error: 'Insufficient permissions' }, { status: 403 })
  }

  const { t } = await resolveTranslations()
  const baseUrl = resolveApiDocsBaseUrl()
  const rawDoc = buildOpenApiDocument(modules, {
    title: t('api.docs.title', 'Open Mercato API'),
    version: APP_VERSION,
    description: t('api.docs.description', 'Auto-generated OpenAPI definition for all enabled modules.'),
    servers: [{ url: baseUrl, description: t('api.docs.serverDescription', 'Default environment') }],
    baseUrlForExamples: baseUrl,
    defaultSecurity: ['bearerAuth'],
  })
  const doc = sanitizeOpenApiDocument(rawDoc)
  const markdown = generateMarkdownFromOpenApi(doc)
  return new Response(markdown, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
