import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getApiDocsExportRouteGetMetadata } from '../../../lib/public-access'
import { resolveApiDocsDocumentForRequest } from '../../../lib/resolve-api-docs-document'

export const metadata = {
  path: '/docs/openapi',
  GET: getApiDocsExportRouteGetMetadata(),
}

export async function GET(req: Request) {
  const doc = await resolveApiDocsDocumentForRequest(req)
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
      description:
        'Requires authentication and api_docs.view unless OM_API_DOCS_PUBLICLY_AVAILABLE is enabled (anonymous export is ACL-redacted).',
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
        { status: 401, description: 'Unauthorized when public mode is disabled' },
        { status: 403, description: 'Forbidden — missing api_docs.view when public mode is disabled' },
      ],
    },
  },
}

