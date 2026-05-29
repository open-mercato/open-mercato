import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { buildSanitizedApiDocsOpenApiDocument } from '../../../lib/openapi-document'

export const metadata = {
  path: '/docs/openapi',
  GET: {
    requireAuth: true,
    requireFeatures: ['api_docs.view'],
  },
}

export async function GET() {
  const doc = await buildSanitizedApiDocsOpenApiDocument()
  return NextResponse.json(doc)
}

export default GET

const openApiInfoSchema = z.object({
  title: z.string(),
  version: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'API Documentation',
  summary: 'OpenAPI JSON document for enabled modules',
  methods: {
    GET: {
      summary: 'Download the OpenAPI 3.1 JSON specification',
      description: 'Requires authentication and the api_docs.view feature.',
      tags: ['API Documentation'],
      responses: [
        {
          status: 200,
          description: 'OpenAPI 3.1 document',
          schema: z.object({
            openapi: z.string(),
            info: openApiInfoSchema,
            paths: z.record(z.string(), z.unknown()),
          }),
        },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Forbidden — missing api_docs.view feature' },
      ],
    },
  },
}
