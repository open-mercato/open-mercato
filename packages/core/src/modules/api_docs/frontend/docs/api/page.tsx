import ApiDocsExplorer from './Explorer'
import { resolveApiDocsBaseUrl } from '@open-mercato/core/modules/api_docs/lib/resources'
import { APP_VERSION } from '@open-mercato/shared/lib/version'
import type { OpenApiDocument } from '@open-mercato/shared/lib/openapi'

type ExplorerOperation = {
  id: string
  path: string
  method: string
  tag: string
  summary?: string
  description?: string
  operation: any
}

function collectOperations(doc: any): ExplorerOperation[] {
  const operations: ExplorerOperation[] = []
  const paths = Object.keys(doc.paths ?? {}).sort((a, b) => a.localeCompare(b))
  for (const path of paths) {
    const methodEntries = Object.entries(doc.paths[path] ?? {})
    for (const [method, operation] of methodEntries) {
      const methodUpper = method.toUpperCase()
      const op = (operation ?? {}) as { summary?: unknown; description?: unknown; tags?: unknown }
      const summary: string | undefined = typeof op.summary === 'string' ? op.summary : undefined
      const description: string | undefined = typeof op.description === 'string' ? op.description : undefined
      const tag = Array.isArray(op.tags) && typeof op.tags[0] === 'string' ? op.tags[0] : 'General'
      operations.push({
        id: `${methodUpper}-${path.replace(/[^\w]+/g, '-')}`,
        path,
        method: methodUpper,
        tag,
        summary,
        description,
        operation,
      })
    }
  }
  return operations
}

function buildTagOrder(doc: any, operations: ExplorerOperation[]): string[] {
  const fromDoc = Array.isArray(doc.tags) ? doc.tags.map((tag: any) => tag?.name).filter(Boolean) : []
  const fromOps = Array.from(new Set(operations.map((operation) => operation.tag)))
  const order: string[] = []
  for (const tag of [...fromDoc, ...fromOps]) {
    if (typeof tag !== 'string') continue
    if (!order.includes(tag)) order.push(tag)
  }
  return order
}

export default async function ApiDocsViewerPage() {
  const baseUrl = resolveApiDocsBaseUrl()
  const response = await fetch(`${baseUrl}/docs/openapi`, { cache: 'no-store' })
  const doc = response.ok
    ? await response.json() as OpenApiDocument
    : {
        openapi: '3.1.0',
        info: {
          title: 'Open Mercato API',
          version: APP_VERSION,
          description: 'Auto-generated OpenAPI definition for all enabled modules.',
        },
        servers: [{ url: baseUrl, description: 'Default environment' }],
        paths: {},
      } satisfies OpenApiDocument

  const operations = collectOperations(doc)
  const tagOrder = buildTagOrder(doc, operations)

  return (
    <ApiDocsExplorer
      title={doc.info?.title ?? 'Open Mercato API'}
      version={doc.info?.version ?? APP_VERSION}
      description={doc.info?.description}
      operations={operations}
      tagOrder={tagOrder}
      servers={doc.servers ?? []}
      docsUrl="https://docs.openmercato.com"
      jsonSpecUrl="/api/docs/openapi"
      markdownSpecUrl="/api/docs/markdown"
    />
  )
}
