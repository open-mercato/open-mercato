import { generateMarkdownFromOpenApi } from '@open-mercato/shared/lib/openapi'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { getApiDocsExportRouteGetMetadata } from '../../../lib/public-access'
import { resolveApiDocsDocumentForRequest } from '../../../lib/resolve-api-docs-document'

export const metadata = {
  path: '/docs/markdown',
  GET: getApiDocsExportRouteGetMetadata(),
}

export async function GET(req: Request) {
  const doc = await resolveApiDocsDocumentForRequest(req)
  const markdown = generateMarkdownFromOpenApi(doc)
  return new Response(markdown, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export default GET

export const openApi: OpenApiRouteDoc = {
  tag: 'API Documentation',
  summary: 'OpenAPI specification rendered as Markdown',
  methods: {
    GET: {
      summary: 'Download the OpenAPI specification as Markdown',
      description:
        'Requires authentication and api_docs.view unless OM_API_DOCS_PUBLICLY_AVAILABLE is enabled (anonymous export is ACL-redacted).',
      tags: ['API Documentation'],
      responses: [
        {
          status: 200,
          description: 'Markdown rendering of the OpenAPI document',
          schema: z.string(),
        },
        { status: 401, description: 'Unauthorized when public mode is disabled' },
        { status: 403, description: 'Forbidden — missing api_docs.view when public mode is disabled' },
      ],
    },
  },
}

