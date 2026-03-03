type RetrievalSliceKind = 'precedent' | 'rationale' | 'neighbor'

export type ExternalRetrievalItem = {
  kind: RetrievalSliceKind
  title: string
  content: string
  sourceRef: string
  score: number
}

export type ExternalRetrievalRequest = {
  tenantId: string
  organizationId: string
  actionType: string
  targetEntity: string
  targetId?: string | null
  signature?: string | null
  query?: string | null
  limit: number
}

export type ExternalRetrievalResult = {
  providerId: string
  items: ExternalRetrievalItem[]
  elapsedMs: number
}

export interface ExternalRetrievalAdapter {
  readonly id: string
  isEnabled(): boolean
  retrieve(input: ExternalRetrievalRequest): Promise<ExternalRetrievalResult>
}

type ExternalRetrievalAttemptOptions = {
  providerId?: string | null
  allowFallback?: boolean
}

export type ExternalRetrievalAttemptResult = ExternalRetrievalResult & {
  fallbackUsed: boolean
}

type RetrievalAdapterServiceDeps = {
  providerId?: string | null
  fallbackProviderId?: string | null
  timeoutMs?: number
}

function clampScore(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.6
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return null
}

function normalizeKind(input: string | null): RetrievalSliceKind {
  if (input === 'rationale' || input === 'neighbor' || input === 'precedent') {
    return input
  }
  return 'precedent'
}

function extractCandidateArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload
  }

  if (!payload || typeof payload !== 'object') {
    return []
  }

  const record = payload as Record<string, unknown>
  const keys = ['items', 'results', 'data', 'matches', 'contexts']
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) {
      return value
    }
  }

  return []
}

function normalizeItems(payload: unknown, providerId: string): ExternalRetrievalItem[] {
  const candidates = extractCandidateArray(payload)

  return candidates
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      const content = readString(record, ['content', 'text', 'summary', 'snippet'])
      if (!content) return null

      const title = readString(record, ['title', 'signature', 'name']) ?? `${providerId} result ${index + 1}`
      const decisionEventId = readString(record, ['decision_event_id', 'decisionEventId'])
      const sourceRef =
        readString(record, ['source_ref', 'sourceRef', 'source', 'doc_id', 'documentId', 'id']) ??
        `${providerId}:${index + 1}`
      const normalizedSourceRef = decisionEventId ? `decision_event:${decisionEventId}` : sourceRef
      const score = clampScore(
        typeof record.score === 'number'
          ? record.score
          : typeof record.similarity === 'number'
            ? record.similarity
            : typeof record.confidence === 'number'
              ? record.confidence
              : null,
      )
      const kind = normalizeKind(readString(record, ['kind', 'type']))

      return {
        kind,
        title,
        content,
        sourceRef: normalizedSourceRef,
        score,
      } satisfies ExternalRetrievalItem
    })
    .filter((item): item is ExternalRetrievalItem => item !== null)
}

function parseJsonSafe(raw: string): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

type HttpAdapterOptions = {
  id: string
  urlEnv: string
  pathEnv: string
  defaultPath: string
  apiKeyEnv: string
  timeoutMs: number
}

function resolveEndpoint(baseRaw: string | null, pathRaw: string | null, defaultPath: string): string | null {
  if (!baseRaw) return null
  const base = baseRaw.trim().replace(/\/+$/, '')
  if (!base) return null
  const path = (pathRaw ?? defaultPath).trim()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalizedPath}`
}

function createHttpExternalRetrievalAdapter(options: HttpAdapterOptions): ExternalRetrievalAdapter {
  const endpoint = resolveEndpoint(
    process.env[options.urlEnv] ?? null,
    process.env[options.pathEnv] ?? null,
    options.defaultPath,
  )
  const apiKey = process.env[options.apiKeyEnv] ?? null

  return {
    id: options.id,
    isEnabled() {
      return Boolean(endpoint)
    },
    async retrieve(input): Promise<ExternalRetrievalResult> {
      if (!endpoint) {
        throw new Error(`${options.id} adapter is not configured.`)
      }

      const startedAt = Date.now()
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: AbortSignal.timeout(options.timeoutMs),
        body: JSON.stringify({
          query:
            input.query ??
            `${input.actionType} ${input.targetEntity}${input.targetId ? ` ${input.targetId}` : ''}`,
          signature: input.signature ?? null,
          actionType: input.actionType,
          targetEntity: input.targetEntity,
          targetId: input.targetId ?? null,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          limit: input.limit,
          topK: input.limit,
          top_k: input.limit,
        }),
      })

      const rawText = await response.text()
      if (!response.ok) {
        throw new Error(`${options.id} retrieval failed (${response.status}): ${rawText}`)
      }

      const payload = parseJsonSafe(rawText)
      const items = normalizeItems(payload, options.id)

      return {
        providerId: options.id,
        items,
        elapsedMs: Date.now() - startedAt,
      }
    },
  }
}

function defaultProviderFromEnv(): string {
  return process.env.AGENT_GOVERNANCE_RETRIEVAL_PROVIDER ?? 'native'
}

function defaultFallbackFromEnv(): string {
  return process.env.AGENT_GOVERNANCE_RETRIEVAL_FALLBACK_PROVIDER ?? 'native'
}

function defaultTimeoutFromEnv(): number {
  const raw = Number.parseInt(process.env.AGENT_GOVERNANCE_RETRIEVAL_TIMEOUT_MS ?? '2500', 10)
  if (!Number.isFinite(raw) || raw < 100) return 2500
  return raw
}

export function createRetrievalAdapterService(deps?: RetrievalAdapterServiceDeps) {
  const configuredProviderId = (deps?.providerId ?? defaultProviderFromEnv()).trim() || 'native'
  const fallbackProviderId = (deps?.fallbackProviderId ?? defaultFallbackFromEnv()).trim() || 'native'
  const timeoutMs = deps?.timeoutMs ?? defaultTimeoutFromEnv()

  const adapters = new Map<string, ExternalRetrievalAdapter>()

  function registerAdapter(adapter: ExternalRetrievalAdapter): void {
    adapters.set(adapter.id, adapter)
  }

  registerAdapter(
    createHttpExternalRetrievalAdapter({
      id: 'lightrag',
      urlEnv: 'AGENT_GOVERNANCE_LIGHTRAG_URL',
      pathEnv: 'AGENT_GOVERNANCE_LIGHTRAG_PATH',
      defaultPath: '/query',
      apiKeyEnv: 'AGENT_GOVERNANCE_LIGHTRAG_API_KEY',
      timeoutMs,
    }),
  )

  registerAdapter(
    createHttpExternalRetrievalAdapter({
      id: 'graphrag_rs',
      urlEnv: 'AGENT_GOVERNANCE_GRAPHRAG_RS_URL',
      pathEnv: 'AGENT_GOVERNANCE_GRAPHRAG_RS_PATH',
      defaultPath: '/search',
      apiKeyEnv: 'AGENT_GOVERNANCE_GRAPHRAG_RS_API_KEY',
      timeoutMs,
    }),
  )

  function listProviders(): string[] {
    return ['native', ...[...adapters.keys()].sort((a, b) => a.localeCompare(b))]
  }

  function getConfiguredProviderId(): string {
    if (configuredProviderId === 'native') return 'native'
    const adapter = adapters.get(configuredProviderId)
    if (!adapter || !adapter.isEnabled()) return 'native'
    return configuredProviderId
  }

  function getAdapter(providerId: string): ExternalRetrievalAdapter | null {
    const adapter = adapters.get(providerId)
    if (!adapter || !adapter.isEnabled()) return null
    return adapter
  }

  async function retrieveWithFallback(
    input: ExternalRetrievalRequest,
    options?: ExternalRetrievalAttemptOptions,
  ): Promise<ExternalRetrievalAttemptResult | null> {
    const preferredProviderId = (options?.providerId ?? getConfiguredProviderId()).trim()
    const allowFallback = options?.allowFallback ?? true

    if (!preferredProviderId || preferredProviderId === 'native') {
      return null
    }

    const preferredAdapter = getAdapter(preferredProviderId)
    if (!preferredAdapter) {
      return null
    }

    try {
      const result = await preferredAdapter.retrieve(input)
      return {
        ...result,
        fallbackUsed: false,
      }
    } catch {
      if (!allowFallback || fallbackProviderId === 'native' || fallbackProviderId === preferredProviderId) {
        return null
      }

      const fallbackAdapter = getAdapter(fallbackProviderId)
      if (!fallbackAdapter) return null

      try {
        const result = await fallbackAdapter.retrieve(input)
        return {
          ...result,
          fallbackUsed: true,
        }
      } catch {
        return null
      }
    }
  }

  return {
    registerAdapter,
    listProviders,
    getConfiguredProviderId,
    retrieveWithFallback,
  }
}

export type RetrievalAdapterService = ReturnType<typeof createRetrievalAdapterService>
