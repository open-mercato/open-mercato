import { modules } from '@/generated/modules.generated'
import { buildOpenApiDocument, generateMarkdownFromOpenApi } from '@open-mercato/shared/lib/openapi'
import Link from 'next/link'
import { MarkdownViewer } from './MarkdownViewer'

function resolveBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'http://localhost:3000'
  )
}

export default async function ApiDocsPage() {
  const baseUrl = resolveBaseUrl()
  const document = buildOpenApiDocument(modules, {
    title: 'Open Mercato API',
    version: '1.0.0',
    description: 'Auto-generated OpenAPI definition for all enabled modules.',
    servers: [{ url: baseUrl, description: 'Default environment' }],
    baseUrlForExamples: baseUrl,
    defaultSecurity: ['bearerAuth'],
  })
  const markdown = generateMarkdownFromOpenApi(document)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">API documentation</h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            This page is generated from the current module registry. Whenever APIs change, rerun{' '}
            <code className="rounded bg-muted px-2 py-0.5 text-xs">npm run modules:prepare</code> to refresh the registry.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/api/docs/openapi"
            className="rounded border px-3 py-1 text-sm hover:bg-muted"
          >
            Download JSON
          </Link>
          <Link
            href="/api/docs/markdown"
            className="rounded border px-3 py-1 text-sm hover:bg-muted"
          >
            Download Markdown
          </Link>
        </div>
      </div>
      <div className="rounded border bg-background p-4">
        <MarkdownViewer markdown={markdown} />
      </div>
    </div>
  )
}
