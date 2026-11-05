import { NextResponse } from 'next/server'
import { modules } from '@/.mercato/generated/modules.runtime.generated'
import { apiRoutes } from '@/.mercato/generated/api-routes.generated'
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
  return NextResponse.json(doc, { headers: API_DOCS_CALLER_SCOPED_HEADERS })
}
