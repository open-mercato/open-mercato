import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { NextResponse } from 'next/server'
import '../../../config/registry' // registers built-in templates as side effect
import { templateRegistry } from '../../../lib/template-registry'

export const metadata = {
  path: '/document-generators/templates',
  GET: { requireAuth: true, requireFeatures: ['document_generators.view'] },
}

/**
 * Returns all available PDF templates grouped by source (internal and external).
 *
 * @returns JSON with `{ internal: TemplateMeta[], external: TemplateMeta[] }`
 */
export async function GET() {
  return NextResponse.json(templateRegistry.listTemplates())
}

export const openApi: OpenApiRouteDoc = {
  methods: {
    GET: {
      summary: 'List available PDF templates grouped by source',
      responses: [
        { status: 200, description: '{ internal: TemplateMeta[], external: TemplateMeta[] }' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
