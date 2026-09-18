import { modules } from '@/.mercato/generated/modules.runtime.generated'
import { apiRoutes } from '@/.mercato/generated/api-routes.generated'
import { generateMarkdownFromOpenApi } from '@open-mercato/shared/lib/openapi'
import {
  API_DOCS_CALLER_SCOPED_HEADERS,
  buildApiDocsOpenApiDocument,
  shouldExposeAccessControlMetadata,
} from '@open-mercato/core/modules/api_docs/lib/document'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const doc = await buildApiDocsOpenApiDocument({
    modules,
    apiRoutes,
    includeAccessControlMetadata: await shouldExposeAccessControlMetadata(req),
  })
  const markdown = generateMarkdownFromOpenApi(doc)
  return new Response(markdown, {
    headers: {
      ...API_DOCS_CALLER_SCOPED_HEADERS,
      'content-type': 'text/markdown; charset=utf-8',
    },
  })
}
