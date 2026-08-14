import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { NextResponse } from 'next/server'
import { templateRegistry } from '../../../../lib/template-registry'
import { TemplateAccessPolicy, type TemplateFeatureAuthorizer } from '../../../../lib/template-access-policy'

export const metadata = {
  path: '/document-generators/templates/options',
  GET: { requireAuth: true, requireFeatures: ['document_generators.documents.view'] },
}

export async function GET(request: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  const templateAccessPolicy = new TemplateAccessPolicy({
    featureAuthorizer: container.resolve<TemplateFeatureAuthorizer>('rbacService'),
    auth,
  })
  const authorizedTemplates = await templateAccessPolicy.filterAuthorizedTemplates({
    templates: templateRegistry.listTemplates(),
  })

  return NextResponse.json(templateRegistry.listTemplateFilterOptions(authorizedTemplates))
}

export const openApi: OpenApiRouteDoc = {
  methods: {
    GET: {
      summary: 'List document template filter options',
      responses: [
        { status: 200, description: 'Available resource kinds and document formats' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
