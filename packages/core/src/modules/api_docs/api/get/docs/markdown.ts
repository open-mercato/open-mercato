import { generateMarkdownFromOpenApi } from '@open-mercato/shared/lib/openapi'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { buildSanitizedApiDocsOpenApiDocument } from '../../../lib/openapi-document'

export const metadata = {
  path: '/docs/markdown',
  GET: {
    requireAuth: true,
    requireFeatures: ['api_docs.view'],
  },
}

export async function GET() {
  const doc = await buildSanitizedApiDocsOpenApiDocument()
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
      description: 'Requires authentication and the api_docs.view feature.',
      tags: ['API Documentation'],
      responses: [
        {
          status: 200,
          description: 'Markdown rendering of the OpenAPI document',
          schema: z.string(),
        },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Forbidden — missing api_docs.view feature' },
      ],
    },
  },
}
