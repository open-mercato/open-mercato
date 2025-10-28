import { modules } from '@/generated/modules.generated'
import { buildOpenApiDocument } from '@open-mercato/shared/lib/openapi'
import { resolveApiDocsBaseUrl } from '@open-mercato/core/modules/api_docs/lib/resources'

const METHOD_STYLES: Record<string, string> = {
  get: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  post: 'bg-blue-100 text-blue-800 border border-blue-200',
  put: 'bg-amber-100 text-amber-800 border border-amber-200',
  patch: 'bg-purple-100 text-purple-800 border border-purple-200',
  delete: 'bg-rose-100 text-rose-800 border border-rose-200',
}

function formatJson(value: unknown): string | null {
  if (!value) return null
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return null
  }
}

function resolveSchemaSnippet(content?: Record<string, any>): string | null {
  if (!content) return null
  const example = content.example ?? content.examples?.default?.value
  const formattedExample = formatJson(example)
  if (formattedExample) return formattedExample
  if (content.schema) {
    const formattedSchema = formatJson(content.schema)
    if (formattedSchema) return formattedSchema
  }
  return null
}

type OperationEntry = {
  path: string
  method: string
  operation: any
}

function collectOperations(doc: any): OperationEntry[] {
  const operations: OperationEntry[] = []
  const sortedPaths = Object.keys(doc.paths ?? {}).sort()
  for (const path of sortedPaths) {
    const methods = Object.keys(doc.paths[path] ?? {}).sort()
    for (const method of methods) {
      operations.push({
        path,
        method,
        operation: (doc.paths[path] as any)[method],
      })
    }
  }
  return operations
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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold">OpenAPI Explorer</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Interactive view of the generated OpenAPI 3.1 document. Use the method badges to navigate endpoints, review request parameters,
          inspect payload schemas, and copy ready-to-run cURL samples.
        </p>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>
            JSON export:{' '}
            <a className="text-primary hover:underline" href="/api/docs/openapi">
              /api/docs/openapi
            </a>
          </span>
          <span>
            Markdown export:{' '}
            <a className="text-primary hover:underline" href="/api/docs/markdown">
              /api/docs/markdown
            </a>
          </span>
        </div>
      </header>

      <section className="space-y-6">
        {operations.map(({ path, method, operation }) => {
          const badgeClass = METHOD_STYLES[method] ?? 'bg-slate-200 text-slate-800 border border-slate-300'
          const parameters = (operation?.parameters as any[]) ?? []
          const requestContent = operation?.requestBody?.content?.['application/json']
          const requestSnippet = resolveSchemaSnippet(requestContent)
          const responses = operation?.responses ?? {}
          const responseStatuses = Object.keys(responses).sort()
          const samples = (operation?.['x-codeSamples'] as any[]) ?? []
          const curlSample =
            samples.find((sample) => String(sample.lang).toLowerCase() === 'curl')?.source ?? samples[0]?.source ?? null
          const requireAuth = Boolean(operation?.['x-require-auth'])
          const requireFeatures = (operation?.['x-require-features'] as string[]) ?? []
          const requireRoles = (operation?.['x-require-roles'] as string[]) ?? []

          return (
            <article key={`${method}-${path}`} className="rounded-lg border bg-card shadow-sm">
              <header className="flex flex-col gap-3 border-b bg-muted/40 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className={`rounded px-2 py-1 text-xs font-semibold uppercase ${badgeClass}`}>{method}</span>
                  <code className="text-sm">{path}</code>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  {requireAuth ? <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">Auth required</span> : null}
                  {requireFeatures.map((feature) => (
                    <span key={feature} className="rounded bg-blue-100 px-2 py-0.5 text-blue-900">
                      {feature}
                    </span>
                  ))}
                  {requireRoles.map((role) => (
                    <span key={role} className="rounded bg-purple-100 px-2 py-0.5 text-purple-900">
                      role:{role}
                    </span>
                  ))}
                </div>
              </header>

              <div className="space-y-5 p-5">
                {operation?.summary ? <h2 className="text-lg font-semibold">{operation.summary}</h2> : null}
                {operation?.description ? <p className="text-sm text-muted-foreground whitespace-pre-line">{operation.description}</p> : null}
                {operation?.tags?.length ? (
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {operation.tags.map((tag: string) => (
                      <span key={tag} className="rounded bg-muted px-2 py-1">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}

                {parameters.length ? (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Parameters</h3>
                    <div className="overflow-x-auto rounded border">
                      <table className="min-w-full divide-y divide-border text-left text-sm">
                        <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 font-medium">Name</th>
                            <th className="px-3 py-2 font-medium">In</th>
                            <th className="px-3 py-2 font-medium">Type</th>
                            <th className="px-3 py-2 font-medium">Required</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border text-sm">
                          {parameters.map((parameter) => (
                            <tr key={`${parameter.in}-${parameter.name}`}>
                              <td className="px-3 py-2 font-medium text-foreground">{parameter.name}</td>
                              <td className="px-3 py-2 text-muted-foreground">{parameter.in}</td>
                              <td className="px-3 py-2 text-muted-foreground">{parameter.schema?.type ?? 'any'}</td>
                              <td className="px-3 py-2 text-muted-foreground">{parameter.required ? 'Yes' : 'No'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ) : null}

                {requestSnippet ? (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Request body</h3>
                    <pre className="max-h-96 overflow-auto rounded bg-muted px-3 py-3 text-xs leading-relaxed text-foreground">
                      {requestSnippet}
                    </pre>
                  </section>
                ) : null}

                {responseStatuses.length ? (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Responses</h3>
                    <div className="space-y-3">
                      {responseStatuses.map((status) => {
                        const response = responses[status]
                        const snippet = resolveSchemaSnippet(response?.content?.['application/json'])
                        return (
                          <div key={status} className="rounded border">
                            <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              <span>{status}</span>
                              <span className="text-muted-foreground">{response?.description ?? 'Response'}</span>
                            </div>
                            {snippet ? (
                              <pre className="max-h-96 overflow-auto bg-muted px-3 py-3 text-xs leading-relaxed text-foreground">
                                {snippet}
                              </pre>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  </section>
                ) : null}

                {curlSample ? (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">cURL example</h3>
                    <pre className="overflow-auto rounded bg-muted px-3 py-3 text-xs leading-relaxed text-foreground">{curlSample}</pre>
                  </section>
                ) : null}
              </div>
            </article>
          )
        })}
      </section>
    </div>
  )
}
