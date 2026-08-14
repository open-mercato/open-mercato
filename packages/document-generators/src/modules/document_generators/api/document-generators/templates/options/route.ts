import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { NextResponse } from 'next/server'
import { templateRegistry } from '../../../../lib/template-registry'

export const metadata = {
  path: '/document-generators/templates/options',
  GET: { requireAuth: true, requireFeatures: ['document_generators.view'] },
}

export async function GET() {
  return NextResponse.json(templateRegistry.listTemplateFilterOptions())
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
