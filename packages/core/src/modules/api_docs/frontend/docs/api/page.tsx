import ApiDocsExplorer from './Explorer'
import { modules } from '@/generated/modules.generated'
import { buildOpenApiDocument } from '@open-mercato/shared/lib/openapi'
import { resolveApiDocsBaseUrl } from '@open-mercato/core/modules/api_docs/lib/resources'

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
  const paths = Object.keys(doc.paths ?? {}).sort()
  for (const path of paths) {
    const methodEntries = Object.entries(doc.paths[path] ?? {})
    for (const [method, operation] of methodEntries) {
      const methodUpper = method.toUpperCase()
      const summary: string | undefined = operation?.summary
      const description: string | undefined = operation?.description
      const tag = Array.isArray(operation?.tags) && operation.tags.length ? operation.tags[0] : 'General'
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
  const doc = buildOpenApiDocument(modules, {
    title: 'Open Mercato API',
    version: '1.0.0',
    description: 'Auto-generated OpenAPI definition for all enabled modules.',
    servers: [{ url: baseUrl, description: 'Default environment' }],
    baseUrlForExamples: baseUrl,
    defaultSecurity: ['bearerAuth'],
  })

  const operations = collectOperations(doc)
  const tagOrder = buildTagOrder(doc, operations)

  return (
    <ApiDocsExplorer
      title={doc.info?.title ?? 'Open Mercato API'}
      version={doc.info?.version ?? '1.0.0'}
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
