import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { NextResponse } from 'next/server'
import { templateRegistry } from '../../../../lib/template-registry'
import { filterTemplatesByAccess } from '../../../_shared/template-access'

export const metadata = {
  path: '/document-generators/templates/options',
  GET: { requireAuth: true, requireFeatures: ['document_generators.documents.view'] },
}

export async function GET(request: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  const templates = await filterTemplatesByAccess(templateRegistry.listTemplates(), { container, auth })
  return NextResponse.json(templateRegistry.listTemplateFilterOptions(templates))
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
