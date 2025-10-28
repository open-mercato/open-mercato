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

const PREFERRED_MEDIA_TYPES = [
  'application/json',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
]

type ContentVariant = {
  mediaType: string
  entry: any
}

function pickContentVariant(content?: Record<string, any>): ContentVariant | null {
  if (!content) return null
  const entries = Object.entries(content)
  if (!entries.length) return null
  for (const mediaType of PREFERRED_MEDIA_TYPES) {
    const match = entries.find(([candidate]) => candidate === mediaType)
    if (match) {
      return { mediaType: match[0], entry: match[1] }
    }
  }
  const [mediaType, entry] = entries[0]
  return { mediaType, entry }
}

function stringifyExample(mediaType: string, example: unknown): string | null {
  if (example === undefined) return null
  if (mediaType === 'application/json') return formatJson(example)
  if (mediaType === 'application/x-www-form-urlencoded') {
    if (!example || typeof example !== 'object') return null
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(example as Record<string, unknown>)) {
      if (value === undefined) continue
      params.append(key, value === null ? '' : String(value))
    }
    const serialized = params.toString()
    return serialized ? serialized : null
  }
  if (mediaType === 'multipart/form-data') {
    if (example && typeof example === 'object') {
      const lines = Object.entries(example as Record<string, unknown>).map(([key, value]) => `${key}=${value ?? ''}`)
      return lines.length ? lines.join('\n') : null
    }
    return typeof example === 'string' ? example : null
  }
  if (typeof example === 'string') return example
  return formatJson(example)
}

function buildExampleFromSchema(schema: any): unknown {
  if (!schema || typeof schema !== 'object') return undefined
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0]

  if (Array.isArray(schema.oneOf) && schema.oneOf.length) return buildExampleFromSchema(schema.oneOf[0])
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) return buildExampleFromSchema(schema.anyOf[0])
  if (Array.isArray(schema.allOf) && schema.allOf.length) {
    return Object.assign({}, ...schema.allOf.map((part: any) => buildExampleFromSchema(part) ?? {}))
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type

  if (schema.properties || type === 'object' || (!type && schema.required)) {
    const properties = schema.properties ?? {}
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(properties)) {
      const value = buildExampleFromSchema(properties[key])
      if (value !== undefined) {
        result[key] = value
      }
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      const value = buildExampleFromSchema(schema.additionalProperties)
      if (value !== undefined) {
        result['additionalProperty'] = value
      }
    }
    return Object.keys(result).length ? result : {}
  }

  if (type === 'array') {
    const itemSchema = schema.items ?? (Array.isArray(schema.prefixItems) ? schema.prefixItems[0] : undefined)
    const value = buildExampleFromSchema(itemSchema)
    return value === undefined ? [] : [value]
  }

  if (type === 'number' || type === 'integer') return 1
  if (type === 'boolean') return true
  if (schema.format === 'date-time') return new Date('2025-01-01T00:00:00.000Z').toISOString()
  if (schema.format === 'uuid') return '00000000-0000-4000-8000-000000000000'
  if (schema.format === 'email') return 'user@example.com'
  if (schema.format === 'uri' || schema.format === 'url') return 'https://example.com/resource'

  return 'string'
}

function hasSchemaDetails(schema: any): boolean {
  if (!schema || typeof schema !== 'object') return false
  if (Array.isArray(schema.enum) && schema.enum.length) return true
  if (schema.const !== undefined) return true
  if (typeof schema.format === 'string') return true
  if (Array.isArray(schema.oneOf) && schema.oneOf.some((s) => hasSchemaDetails(s))) return true
  if (Array.isArray(schema.anyOf) && schema.anyOf.some((s) => hasSchemaDetails(s))) return true
  if (Array.isArray(schema.allOf) && schema.allOf.some((s) => hasSchemaDetails(s))) return true
  if (schema.items && hasSchemaDetails(schema.items)) return true
  if (schema.properties && Object.keys(schema.properties).length) return true
  if (Array.isArray(schema.prefixItems) && schema.prefixItems.some((s) => hasSchemaDetails(s))) return true
  if (schema.type && schema.type !== 'object') return true
  return false
}

type ContentSnippet = {
  mediaType: string
  snippet: string | null
  hadSchema: boolean
}

function resolveContentSnippet(content?: Record<string, any>): ContentSnippet | null {
  const variant = pickContentVariant(content)
  if (!variant) return null
  const { mediaType, entry } = variant
  const example = entry?.example ?? entry?.examples?.default?.value
  const exampleSnippet = stringifyExample(mediaType, example)
  if (exampleSnippet) return { mediaType, snippet: exampleSnippet, hadSchema: Boolean(entry?.schema) }
  const generated = buildExampleFromSchema(entry?.schema)
  const generatedSnippet = stringifyExample(mediaType, generated)
  if (generatedSnippet) return { mediaType, snippet: generatedSnippet, hadSchema: Boolean(entry?.schema) }
  const schemaSnippet = entry?.schema && hasSchemaDetails(entry.schema) ? formatJson(entry.schema) : null
  if (schemaSnippet) return { mediaType, snippet: schemaSnippet, hadSchema: true }
  return { mediaType, snippet: null, hadSchema: Boolean(entry?.schema) }
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
          const requestSnippetInfo = resolveContentSnippet(operation?.requestBody?.content)
          const hasRequestBody = Boolean(operation?.requestBody)
          const responses = operation?.responses ?? {}
          const responseStatuses = Object.keys(responses)
            .filter((status) => !responses[status]?.['x-autoGenerated'])
            .sort()
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

                {requestSnippetInfo && (requestSnippetInfo.snippet || hasRequestBody) ? (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Request body</h3>
                    <div className="rounded border bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground">
                      Content-Type: {requestSnippetInfo.mediaType}
                    </div>
                    {requestSnippetInfo.snippet ? (
                      <pre className="max-h-96 overflow-auto rounded bg-muted px-3 py-3 text-xs leading-relaxed text-foreground">
                        {requestSnippetInfo.snippet}
                      </pre>
                    ) : (
                      <p className="text-xs text-muted-foreground">No example available for this content type.</p>
                    )}
                  </section>
                ) : null}

                {responseStatuses.length ? (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Responses</h3>
                    <div className="space-y-3">
                      {responseStatuses.map((status) => {
                        const response = responses[status]
                        const snippetInfo = resolveContentSnippet(response?.content)
                        const hasContent = Boolean(response?.content)
                        const fallbackMessage =
                          status === '204' || !hasContent ? 'No response body.' : 'No example available for this content type.'
                        return (
                          <div key={status} className="rounded border">
                            <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              <span>{status}</span>
                              <span className="text-muted-foreground">{response?.description ?? 'Response'}</span>
                            </div>
                            {snippetInfo && hasContent ? (
                              <>
                                <div className="border-b bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">
                                  Content-Type: {snippetInfo.mediaType}
                                </div>
                                {snippetInfo.snippet ? (
                                  <pre className="max-h-96 overflow-auto bg-muted px-3 py-3 text-xs leading-relaxed text-foreground">
                                    {snippetInfo.snippet}
                                  </pre>
                                ) : (
                                  <p className="px-3 py-3 text-xs text-muted-foreground">{fallbackMessage}</p>
                                )}
                              </>
                            ) : (
                              <p className="px-3 py-3 text-xs text-muted-foreground">{fallbackMessage}</p>
                            )}
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
