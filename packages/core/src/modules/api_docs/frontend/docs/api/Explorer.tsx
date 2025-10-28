'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'

const METHOD_STYLES: Record<string, string> = {
  GET: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  POST: 'bg-blue-100 text-blue-800 border border-blue-200',
  PUT: 'bg-amber-100 text-amber-800 border border-amber-200',
  PATCH: 'bg-purple-100 text-purple-800 border border-purple-200',
  DELETE: 'bg-rose-100 text-rose-800 border border-rose-200',
}

const PREFERRED_MEDIA_TYPES = [
  'application/json',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
]

type ExplorerOperation = {
  id: string
  path: string
  method: string
  tag: string
  summary?: string
  description?: string
  operation: any
}

type ServerOption = { url: string; description?: string }

type ApiDocsExplorerProps = {
  title: string
  version: string
  description?: string
  operations: ExplorerOperation[]
  tagOrder: string[]
  servers: ServerOption[]
  docsUrl: string
}

type ContentVariant = {
  mediaType: string
  entry: any
}

type TestResponse = {
  status: number
  durationMs: number
  ok: boolean
  body: string
  parsed?: unknown
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

function stringifyExample(mediaType: string, example: unknown): string {
  if (example === undefined || example === null) return ''
  if (mediaType === 'application/json') {
    try {
      return JSON.stringify(example, null, 2)
    } catch {
      return ''
    }
  }
  if (mediaType === 'application/x-www-form-urlencoded') {
    if (typeof example !== 'object') return ''
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(example as Record<string, unknown>)) {
      if (value === undefined) continue
      params.append(key, value === null ? '' : String(value))
    }
    return params.toString()
  }
  if (mediaType === 'multipart/form-data') {
    if (typeof example === 'object') {
      return Object.entries(example as Record<string, unknown>)
        .map(([key, value]) => `${key}=${value ?? ''}`)
        .join('\n')
    }
    return typeof example === 'string' ? example : ''
  }
  if (typeof example === 'string') return example
  try {
    return JSON.stringify(example, null, 2)
  } catch {
    return ''
  }
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

function applyPathParams(path: string, params: Record<string, string>): string {
  return path.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = params[key] ?? ''
    return value ? encodeURIComponent(value) : `{${key}}`
  })
}

type Category = {
  tag: string
  operations: ExplorerOperation[]
}

export default function ApiDocsExplorer(props: ApiDocsExplorerProps) {
  const { title, version, description, operations, tagOrder, servers, docsUrl } = props

  const methodOptions = useMemo(
    () => Array.from(new Set(operations.map((operation) => operation.method))).sort((a, b) => a.localeCompare(b)),
    [operations]
  )

  const operationsById = useMemo(() => {
    const map = new Map<string, ExplorerOperation>()
    for (const operation of operations) {
      map.set(operation.id, operation)
    }
    return map
  }, [operations])

  const [searchTerm, setSearchTerm] = useState('')
  const [methodFilter, setMethodFilter] = useState<string[]>(methodOptions)
  const [selectedId, setSelectedId] = useState<string>(operations[0]?.id ?? '')
  const [isNavOpen, setIsNavOpen] = useState(false)
  const [isTesterOpen, setIsTesterOpen] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [baseUrl, setBaseUrl] = useState<string>(servers[0]?.url ?? '')
  const [apiKey, setApiKey] = useState<string>('')

  useEffect(() => {
    setMethodFilter(methodOptions)
  }, [methodOptions])

  useEffect(() => {
    if (servers.length === 0) return
    setBaseUrl((prev) => {
      if (!prev) return servers[0].url
      return prev
    })
  }, [servers])

  const filteredOperations = useMemo(() => {
    const lowered = searchTerm.trim().toLowerCase()
    return operations.filter((operation) => {
      if (!methodFilter.includes(operation.method)) return false
      if (!lowered) return true
      return (
        operation.path.toLowerCase().includes(lowered) ||
        (operation.summary && operation.summary.toLowerCase().includes(lowered)) ||
        (operation.description && operation.description.toLowerCase().includes(lowered))
      )
    })
  }, [operations, methodFilter, searchTerm])

  const categories = useMemo(() => {
    const grouped = new Map<string, ExplorerOperation[]>()
    for (const operation of filteredOperations) {
      const list = grouped.get(operation.tag) ?? []
      list.push(operation)
      grouped.set(operation.tag, list)
    }
    const ordered: Category[] = []
    for (const tag of tagOrder) {
      const list = grouped.get(tag)
      if (list && list.length) {
        ordered.push({ tag, operations: list })
        grouped.delete(tag)
      }
    }
    const remaining = Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b))
    for (const [tag, ops] of remaining) {
      ordered.push({ tag, operations: ops })
    }
    return ordered
  }, [filteredOperations, tagOrder])

  useEffect(() => {
    setExpanded((prev) => {
      const next: Record<string, boolean> = {}
      for (const category of categories) {
        next[category.tag] = prev[category.tag] ?? true
      }
      return next
    })
  }, [categories])

  useEffect(() => {
    if (!selectedId && filteredOperations.length) {
      setSelectedId(filteredOperations[0].id)
      return
    }
    if (selectedId && filteredOperations.some((operation) => operation.id === selectedId)) return
    if (filteredOperations.length) {
      setSelectedId(filteredOperations[0].id)
    }
  }, [filteredOperations, selectedId])

  const selectedOperation =
    (selectedId ? operationsById.get(selectedId) : undefined) ?? filteredOperations[0] ?? operations[0] ?? null

  const shouldOpenTesterOverlay = () => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < 1280
  }

  const handleSelectOperation = (operationId: string) => {
    setSelectedId(operationId)
    const element = document.getElementById(`operation-${operationId}`)
    if (element) element.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' })
    if (shouldOpenTesterOverlay()) setIsTesterOpen(true)
    setIsNavOpen(false)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border text-sm font-medium text-muted-foreground hover:border-foreground hover:text-foreground lg:hidden"
              onClick={() => setIsNavOpen(true)}
            >
              <span className="sr-only">Open navigation</span>
              ☰
            </button>
            <Link href="/" className="flex items-center gap-3">
              <Image src="/open-mercato.svg" alt="Open Mercato" width={36} height={36} />
              <div>
                <div className="text-base font-semibold leading-tight">{title}</div>
                <div className="text-xs text-muted-foreground">Version {version}</div>
              </div>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <nav className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              <Link href="/" className="hover:text-foreground hover:underline">
                Home
              </Link>
              <span>/</span>
              <span>Docs</span>
              <span>/</span>
              <span className="font-medium text-foreground">API Explorer</span>
            </nav>
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-muted-foreground hover:border-foreground hover:text-foreground xl:hidden"
              onClick={() => setIsTesterOpen(true)}
            >
              Try Endpoint
            </button>
            <Link
              href={docsUrl}
              target="_blank"
              rel="noreferrer"
              className="hidden rounded-md border border-primary/30 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 sm:inline-flex"
            >
              View full docs
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-8 lg:flex-row lg:gap-6">
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">API Categories</h2>
            <nav className="mt-4 space-y-4 text-sm">
              {categories.map((category) => {
                const isExpanded = expanded[category.tag] ?? true
                return (
                  <div key={category.tag} className="space-y-2">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-md bg-muted px-3 py-2 text-left font-medium text-foreground hover:bg-muted/80"
                      onClick={() =>
                        setExpanded((prev) => ({
                          ...prev,
                          [category.tag]: !isExpanded,
                        }))
                      }
                    >
                      <span>{category.tag}</span>
                      <span className="text-xs text-muted-foreground">{isExpanded ? '−' : '+'}</span>
                    </button>
                    {isExpanded ? (
                      <ul className="space-y-1 pl-2">
                        {category.operations.map((operation) => (
                          <li key={operation.id}>
                            <button
                              type="button"
                              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition ${
                                selectedOperation?.id === operation.id
                                  ? 'bg-primary/10 text-primary'
                                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                              }`}
                              onClick={() => handleSelectOperation(operation.id)}
                            >
                              <span
                                className={`inline-flex min-w-[3rem] justify-center rounded border px-2 py-0.5 text-[11px] font-semibold uppercase ${
                                  METHOD_STYLES[operation.method] ?? 'border border-border bg-muted text-foreground'
                                }`}
                              >
                                {operation.method}
                              </span>
                              <span className="truncate text-xs">{operation.path}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )
              })}
            </nav>
          </div>
        </aside>

        <section className="flex-1 space-y-6">
          <div className="rounded-lg border bg-card p-5 shadow-sm">
            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h1 className="text-2xl font-semibold">OpenAPI Explorer</h1>
                  {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {servers[0]?.url ? <span>Default server: {servers[0].url}</span> : <span>Server URL not configured.</span>}
                </div>
              </div>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-1 items-center gap-3">
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search endpoints by path or summary"
                    className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {methodOptions.map((method) => {
                    const isActive = methodFilter.includes(method)
                    return (
                      <button
                        key={method}
                        type="button"
                        className={`rounded-md border px-3 py-1 font-semibold uppercase transition ${
                          isActive
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground'
                        }`}
                        onClick={() => {
                          setMethodFilter((prev) => {
                            if (prev.includes(method)) {
                              const next = prev.filter((entry) => entry !== method)
                              return next.length ? next : prev
                            }
                            return [...prev, method]
                          })
                        }}
                      >
                        {method}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-8">
            {categories.map((category) => (
              <div key={category.tag} className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">{category.tag}</h2>
                  <div className="text-xs text-muted-foreground">{category.operations.length} endpoints</div>
                </div>
                <div className="space-y-6">
                  {category.operations.map((operation) => {
                    const methodClass = METHOD_STYLES[operation.method] ?? 'border border-border bg-muted text-foreground'
                    const operationId = `operation-${operation.id}`
                    const contentVariant = pickContentVariant(operation.operation?.requestBody?.content)
                    const contentExample =
                      contentVariant?.entry?.example ??
                      contentVariant?.entry?.examples?.default?.value ??
                      buildExampleFromSchema(contentVariant?.entry?.schema)
                    const requestSnippet =
                      contentVariant && contentExample
                        ? stringifyExample(contentVariant.mediaType, contentExample)
                        : undefined

                    return (
                      <article
                        key={operation.id}
                        id={operationId}
                        className={`rounded-lg border bg-card shadow-sm transition ${
                          selectedOperation?.id === operation.id ? 'ring-2 ring-primary/40' : ''
                        }`}
                      >
                        <div className="flex flex-col gap-4 border-b bg-muted/40 px-5 py-4 md:flex-row md:items-center md:justify-between">
                          <div className="flex items-center gap-3">
                            <span className={`rounded px-3 py-1 text-xs font-semibold uppercase ${methodClass}`}>
                              {operation.method}
                            </span>
                            <code className="text-sm text-foreground">{operation.path}</code>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            {operation.operation?.['x-require-auth'] ? (
                              <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">Auth required</span>
                            ) : null}
                            {Array.isArray(operation.operation?.['x-require-features'])
                              ? operation.operation['x-require-features'].map((feature: string) => (
                                  <span key={feature} className="rounded bg-blue-100 px-2 py-0.5 text-blue-900">
                                    {feature}
                                  </span>
                                ))
                              : null}
                          </div>
                        </div>
                        <div className="space-y-5 p-5">
                          <div className="space-y-2">
                            {operation.summary ? <h3 className="text-lg font-semibold">{operation.summary}</h3> : null}
                            {operation.description ? (
                              <p className="text-sm text-muted-foreground whitespace-pre-line">
                                {operation.description}
                              </p>
                            ) : null}
                          </div>

                          {Array.isArray(operation.operation?.parameters) &&
                          operation.operation.parameters.length ? (
                            <section className="space-y-3">
                              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Parameters
                              </h4>
                              <div className="overflow-hidden rounded-lg border">
                                <table className="min-w-full divide-y divide-border text-left text-xs">
                                  <thead className="bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                                    <tr>
                                      <th className="px-3 py-2 font-medium">Name</th>
                                      <th className="px-3 py-2 font-medium">In</th>
                                      <th className="px-3 py-2 font-medium">Required</th>
                                      <th className="px-3 py-2 font-medium">Schema</th>
                                      <th className="px-3 py-2 font-medium">Description</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border text-xs">
                                    {operation.operation.parameters.map((parameter: any) => (
                                      <tr key={`${parameter.in}-${parameter.name}`}>
                                        <td className="px-3 py-2 font-medium text-foreground">{parameter.name}</td>
                                        <td className="px-3 py-2 text-muted-foreground">{parameter.in}</td>
                                        <td className="px-3 py-2 text-muted-foreground">
                                          {parameter.required ? 'Yes' : 'No'}
                                        </td>
                                        <td className="px-3 py-2 text-muted-foreground">
                                          {parameter.schema?.type ?? 'any'}
                                        </td>
                                        <td className="px-3 py-2 text-muted-foreground">
                                          {parameter.description ?? '—'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </section>
                          ) : null}

                          {contentVariant ? (
                            <section className="space-y-3">
                              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Request body ({contentVariant.mediaType})
                              </h4>
                              {requestSnippet ? (
                                <pre className="max-h-80 overflow-auto rounded-lg bg-muted px-4 py-3 text-xs leading-relaxed">
                                  {requestSnippet}
                                </pre>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  No example available for this content type.
                                </p>
                              )}
                            </section>
                          ) : null}

                          {operation.operation?.responses ? (
                            <section className="space-y-3">
                              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Responses
                              </h4>
                              <div className="space-y-3">
                                {Object.entries(operation.operation.responses).map(([status, response]: [string, any]) => {
                                  if (response?.['x-autoGenerated']) return null
                                  const responseVariant = pickContentVariant(response?.content)
                                  const responseExample =
                                    responseVariant?.entry?.example ??
                                    responseVariant?.entry?.examples?.default?.value ??
                                    buildExampleFromSchema(responseVariant?.entry?.schema)
                                  const responseSnippet =
                                    responseVariant && responseExample
                                      ? stringifyExample(responseVariant.mediaType, responseExample)
                                      : undefined

                                  return (
                                    <div key={status} className="rounded-lg border">
                                      <div className="flex items-center justify-between border-b bg-muted/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                        <span>{status}</span>
                                        <span className="text-muted-foreground">
                                          {response?.description ?? 'Response'}
                                        </span>
                                      </div>
                                      {responseVariant ? (
                                        <div className="border-b bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
                                          Content-Type: {responseVariant.mediaType}
                                        </div>
                                      ) : null}
                                      {responseSnippet ? (
                                        <pre className="max-h-80 overflow-auto bg-muted px-4 py-3 text-xs leading-relaxed">
                                          {responseSnippet}
                                        </pre>
                                      ) : (
                                        <p className="px-4 py-3 text-xs text-muted-foreground">
                                          {responseVariant ? 'No example available for this content type.' : 'No response body.'}
                                        </p>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </section>
                          ) : null}

                          {Array.isArray(operation.operation?.['x-codeSamples']) &&
                          operation.operation['x-codeSamples'].length ? (
                            <section className="space-y-3">
                              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Example
                              </h4>
                              <pre className="overflow-auto rounded-lg bg-muted px-4 py-3 text-xs leading-relaxed">
                                {operation.operation['x-codeSamples'][0].source}
                              </pre>
                            </section>
                          ) : null}

                          <div className="flex flex-wrap gap-3">
                            <button
                              type="button"
                              className="inline-flex items-center rounded-md border border-primary px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/10"
                              onClick={() => {
                                setSelectedId(operation.id)
                                if (shouldOpenTesterOverlay()) setIsTesterOpen(true)
                              }}
                            >
                              Test this endpoint
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:border-foreground hover:text-foreground"
                              onClick={() => handleSelectOperation(operation.id)}
                            >
                              Jump to tester
                            </button>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </div>
            ))}
            {!categories.length ? (
              <div className="rounded-lg border border-dashed bg-muted/40 p-6 text-center text-sm text-muted-foreground">
                No endpoints match your filters. Try adjusting the method filters or clearing the search query.
              </div>
            ) : null}
          </div>
        </section>

        <aside className="hidden w-96 shrink-0 xl:block">
          <TesterPanel
            key={selectedOperation?.id ?? 'tester'}
            operation={selectedOperation}
            baseUrl={baseUrl}
            setBaseUrl={setBaseUrl}
            baseUrlOptions={servers}
            apiKey={apiKey}
            setApiKey={setApiKey}
          />
        </aside>
      </main>

      <footer className="border-t bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-muted-foreground">© {new Date().getFullYear()} Open Mercato. All rights reserved.</div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <Link href={docsUrl} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">
              Documentation
            </Link>
            <Link
              href="https://openmercato.com/privacy"
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground hover:underline"
            >
              Privacy
            </Link>
            <Link
              href="https://openmercato.com/terms"
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground hover:underline"
            >
              Terms
            </Link>
          </div>
        </div>
      </footer>

      {isNavOpen ? (
        <MobileOverlay title="API categories" onClose={() => setIsNavOpen(false)}>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">API Categories</h2>
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setIsNavOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="max-h-[70vh] space-y-4 overflow-y-auto">
              {categories.map((category) => (
                <div key={`mobile-${category.tag}`} className="space-y-2">
                  <div className="font-semibold text-foreground">{category.tag}</div>
                  <ul className="space-y-2">
                    {category.operations.map((operation) => (
                      <li key={`mobile-${operation.id}`}>
                        <button
                          type="button"
                          className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm ${
                            selectedOperation?.id === operation.id
                              ? 'border-primary text-primary'
                              : 'border-border text-muted-foreground'
                          }`}
                          onClick={() => handleSelectOperation(operation.id)}
                        >
                          <span
                            className={`inline-flex min-w-[3rem] justify-center rounded border px-2 py-0.5 text-[11px] font-semibold uppercase ${
                              METHOD_STYLES[operation.method] ?? 'border border-border bg-muted text-foreground'
                            }`}
                          >
                            {operation.method}
                          </span>
                          <span className="truncate">{operation.path}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </MobileOverlay>
      ) : null}

      {isTesterOpen ? (
        <MobileOverlay title="API tester" onClose={() => setIsTesterOpen(false)}>
          <TesterPanel
            key={`mobile-${selectedOperation?.id ?? 'tester'}`}
            operation={selectedOperation}
            baseUrl={baseUrl}
            setBaseUrl={setBaseUrl}
            baseUrlOptions={servers}
            apiKey={apiKey}
            setApiKey={setApiKey}
          />
        </MobileOverlay>
      ) : null}
    </div>
  )
}

function MobileOverlay(props: { title: string; children: ReactNode; onClose: () => void }) {
  const { title, children, onClose } = props
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur">
      <div className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1 text-sm text-muted-foreground hover:border-foreground hover:text-foreground"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
    </div>
  )
}

type TesterPanelProps = {
  operation: ExplorerOperation | null
  baseUrl: string
  setBaseUrl: (value: string) => void
  baseUrlOptions: ServerOption[]
  apiKey: string
  setApiKey: (value: string) => void
}

function TesterPanel(props: TesterPanelProps) {
  const { operation, baseUrl, setBaseUrl, baseUrlOptions, apiKey, setApiKey } = props
  const [pathValues, setPathValues] = useState<Record<string, string>>({})
  const [queryValues, setQueryValues] = useState<Record<string, string>>({})
  const [bodyContent, setBodyContent] = useState<string>('')
  const [response, setResponse] = useState<TestResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const parameters = useMemo(
    () => (operation && Array.isArray(operation.operation?.parameters) ? operation.operation.parameters : []),
    [operation]
  )
  const pathParams = useMemo(
    () => parameters.filter((parameter: any) => parameter.in === 'path'),
    [parameters]
  )
  const queryParams = useMemo(
    () => parameters.filter((parameter: any) => parameter.in === 'query'),
    [parameters]
  )
  const requestVariant = useMemo(
    () => (operation ? pickContentVariant(operation.operation?.requestBody?.content) : null),
    [operation]
  )
  const mergedBaseUrls = useMemo(() => {
    if (!baseUrl) return baseUrlOptions
    if (baseUrlOptions.some((server) => server.url === baseUrl)) return baseUrlOptions
    return [...baseUrlOptions, { url: baseUrl }]
  }, [baseUrlOptions, baseUrl])

  useEffect(() => {
    const nextPath: Record<string, string> = {}
    for (const parameter of pathParams) {
      nextPath[parameter.name] = ''
    }
    const nextQuery: Record<string, string> = {}
    for (const parameter of queryParams) {
      nextQuery[parameter.name] = ''
    }
    setPathValues(nextPath)
    setQueryValues(nextQuery)

    if (requestVariant) {
      const example =
        requestVariant.entry?.example ??
        requestVariant.entry?.examples?.default?.value ??
        buildExampleFromSchema(requestVariant.entry?.schema)
      setBodyContent(example ? stringifyExample(requestVariant.mediaType, example) : '')
    } else {
      setBodyContent('')
    }
    setResponse(null)
    setError(null)
  }, [operation?.id, pathParams, queryParams, requestVariant])

  if (!operation) {
    return (
      <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
        Select an endpoint to start testing requests.
      </div>
    )
  }

  const handleSubmit = async () => {
    if (!baseUrl) {
      setError('Please provide a base URL for the request.')
      return
    }

    const requiredPathParam = pathParams.find((param: any) => param.required && !pathValues[param.name])
    if (requiredPathParam) {
      setError(`Path parameter "${requiredPathParam.name}" is required.`)
      return
    }

    const method = operation.method.toUpperCase()
    const headers: Record<string, string> = { Accept: 'application/json' }
    let body: BodyInit | undefined

    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey.trim()}`
    }

    if (requestVariant && method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = requestVariant.mediaType
      if (requestVariant.mediaType === 'application/json') {
        try {
          body = bodyContent ? JSON.stringify(JSON.parse(bodyContent)) : undefined
        } catch (cause) {
          setError('Request body must be valid JSON.')
          return
        }
      } else if (requestVariant.mediaType === 'application/x-www-form-urlencoded') {
        body = bodyContent
      } else {
        body = bodyContent
      }
    }

    const resolvedPath = applyPathParams(operation.path, pathValues)
    const url = new URL(resolvedPath.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
    for (const [key, value] of Object.entries(queryValues)) {
      if (!value) continue
      url.searchParams.append(key, value)
    }

    setIsLoading(true)
    setError(null)
    setResponse(null)

    try {
      const started = performance.now()
      const res = await fetch(url.toString(), {
        method,
        headers,
        body,
      })
      const duration = performance.now() - started
      const text = await res.text()
      let parsed: unknown | undefined
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = undefined
      }
      setResponse({
        status: res.status,
        ok: res.ok,
        durationMs: Math.round(duration),
        body: text,
        parsed,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed. Check your network connection.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Interactive tester</h2>
          <p className="text-xs text-muted-foreground">
            Provide the endpoint parameters and your API token to execute a live request.
          </p>
        </div>
        <span
          className={`inline-flex min-w-[3rem] justify-center rounded border px-2 py-0.5 text-[11px] font-semibold uppercase ${
            METHOD_STYLES[operation.method] ?? 'border border-border bg-muted text-foreground'
          }`}
        >
          {operation.method}
        </span>
      </div>

      <div className="space-y-2 text-xs">
        <div className="font-semibold text-foreground">Endpoint</div>
        <code className="rounded-md bg-muted px-3 py-2 text-xs text-primary">{operation.path}</code>
      </div>

      <label className="space-y-2 text-sm">
        <span className="font-medium text-foreground">Base URL</span>
        <select
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          {mergedBaseUrls.map((server) => (
            <option key={server.url} value={server.url}>
              {server.url} {server.description ? `— ${server.description}` : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-2 text-sm">
        <span className="font-medium text-foreground">API token</span>
        <input
          type="text"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="Paste your Bearer API token"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </label>

      {pathParams.length ? (
        <section className="space-y-2 text-sm">
          <div className="font-medium text-foreground">Path parameters</div>
          <div className="space-y-3">
            {pathParams.map((parameter: any) => (
              <label key={parameter.name} className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{parameter.name}</span>
                  {parameter.required ? <span className="text-amber-600">required</span> : null}
                </div>
                <input
                  type="text"
                  value={pathValues[parameter.name] ?? ''}
                  onChange={(event) =>
                    setPathValues((prev) => ({
                      ...prev,
                      [parameter.name]: event.target.value,
                    }))
                  }
                  placeholder={parameter.description ?? ''}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {queryParams.length ? (
        <section className="space-y-2 text-sm">
          <div className="font-medium text-foreground">Query parameters</div>
          <div className="space-y-3">
            {queryParams.map((parameter: any) => (
              <label key={parameter.name} className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{parameter.name}</span>
                  {parameter.required ? <span className="text-amber-600">required</span> : null}
                </div>
                <input
                  type="text"
                  value={queryValues[parameter.name] ?? ''}
                  onChange={(event) =>
                    setQueryValues((prev) => ({
                      ...prev,
                      [parameter.name]: event.target.value,
                    }))
                  }
                  placeholder={parameter.description ?? ''}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {requestVariant ? (
        <section className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">Request body</span>
            <span className="text-xs text-muted-foreground">{requestVariant.mediaType}</span>
          </div>
          <textarea
            value={bodyContent}
            onChange={(event) => setBodyContent(event.target.value)}
            rows={8}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono leading-relaxed focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="Provide request payload"
          />
        </section>
      ) : null}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={isLoading}
        className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-primary/60"
      >
        {isLoading ? 'Sending…' : 'Send request'}
      </button>

      {error ? <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div> : null}

      {response ? (
        <section className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <div className="font-medium text-foreground">
              Response · <span className={response.ok ? 'text-emerald-600' : 'text-rose-600'}>{response.status}</span>
            </div>
            <div className="text-xs text-muted-foreground">{response.durationMs} ms</div>
          </div>
          <pre className="max-h-80 overflow-auto rounded-md bg-muted px-3 py-2 text-xs leading-relaxed">
            {response.parsed ? formatJson(response.parsed) : response.body || '(empty response)'}
          </pre>
        </section>
      ) : null}
    </div>
  )
}
