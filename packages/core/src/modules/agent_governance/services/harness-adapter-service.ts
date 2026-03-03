import { HarnessCapabilityError } from '../lib/domain-errors'

export type HarnessProviderId = 'opencode' | 'claude_agent_sdk' | string

export type HarnessInvokeRequest = {
  prompt: string
  sessionId?: string | null
  model?: {
    providerId: string
    modelId: string
  }
  metadata?: Record<string, unknown>
}

export type HarnessInvokeResult = {
  provider: HarnessProviderId
  sessionId: string | null
  text: string | null
  raw: unknown
}

export type HarnessSessionRequest = {
  sessionId?: string | null
}

export type HarnessSessionResult = {
  provider: HarnessProviderId
  sessionId: string
}

export type HarnessStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; sessionId: string | null; raw: unknown }
  | { type: 'error'; error: string }

export interface HarnessAdapter {
  readonly id: HarnessProviderId
  invoke(input: HarnessInvokeRequest): Promise<HarnessInvokeResult>
  stream(
    input: HarnessInvokeRequest,
    onEvent: (event: HarnessStreamEvent) => Promise<void>,
  ): Promise<HarnessInvokeResult>
  session(input: HarnessSessionRequest): Promise<HarnessSessionResult>
}

type OpenCodeAdapterOptions = {
  baseUrl?: string
  password?: string
}

function parseOpenCodeText(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const parts = (raw as { parts?: unknown[] }).parts
  if (!Array.isArray(parts)) return null

  const text = parts
    .map((part) => {
      if (!part || typeof part !== 'object') return null
      const typed = part as { type?: unknown; text?: unknown }
      if (typed.type !== 'text' || typeof typed.text !== 'string') return null
      return typed.text
    })
    .filter((value): value is string => typeof value === 'string' && value.length > 0)

  return text.length > 0 ? text.join('\n') : null
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const raw = await response.text()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export function createOpenCodeHarnessAdapter(options?: OpenCodeAdapterOptions): HarnessAdapter {
  const baseUrl = (options?.baseUrl ?? process.env.OPENCODE_URL ?? 'http://localhost:4096').replace(/\/$/, '')
  const password = options?.password ?? process.env.OPENCODE_PASSWORD

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (password) {
    const credentials = Buffer.from(`opencode:${password}`).toString('base64')
    headers.Authorization = `Basic ${credentials}`
  }

  async function session(input: HarnessSessionRequest): Promise<HarnessSessionResult> {
    const requestedSessionId = input.sessionId ?? null

    if (requestedSessionId) {
      const response = await fetch(`${baseUrl}/session/${encodeURIComponent(requestedSessionId)}`, {
        method: 'GET',
        headers,
      })

      if (!response.ok) {
        const detail = await parseJsonSafe(response)
        throw new Error(`OpenCode session lookup failed (${response.status}): ${JSON.stringify(detail)}`)
      }

      return {
        provider: 'opencode',
        sessionId: requestedSessionId,
      }
    }

    const response = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    })

    if (!response.ok) {
      const detail = await parseJsonSafe(response)
      throw new Error(`OpenCode session creation failed (${response.status}): ${JSON.stringify(detail)}`)
    }

    const payload = (await response.json()) as { id?: unknown }
    const sessionId = typeof payload.id === 'string' ? payload.id : null

    if (!sessionId) {
      throw new Error('OpenCode session creation returned no session id.')
    }

    return {
      provider: 'opencode',
      sessionId,
    }
  }

  async function invoke(input: HarnessInvokeRequest): Promise<HarnessInvokeResult> {
    const activeSession = await session({ sessionId: input.sessionId ?? null })

    const body: Record<string, unknown> = {
      parts: [{ type: 'text', text: input.prompt }],
    }

    if (input.model) {
      body.model = {
        providerID: input.model.providerId,
        modelID: input.model.modelId,
      }
    }

    const response = await fetch(
      `${baseUrl}/session/${encodeURIComponent(activeSession.sessionId)}/message`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
    )

    if (!response.ok) {
      const detail = await parseJsonSafe(response)
      throw new Error(`OpenCode invoke failed (${response.status}): ${JSON.stringify(detail)}`)
    }

    const raw = await response.json()

    return {
      provider: 'opencode',
      sessionId: activeSession.sessionId,
      text: parseOpenCodeText(raw),
      raw,
    }
  }

  async function stream(
    input: HarnessInvokeRequest,
    onEvent: (event: HarnessStreamEvent) => Promise<void>,
  ): Promise<HarnessInvokeResult> {
    try {
      const result = await invoke(input)
      if (result.text) {
        await onEvent({ type: 'text', text: result.text })
      }
      await onEvent({ type: 'done', sessionId: result.sessionId, raw: result.raw })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await onEvent({ type: 'error', error: message })
      throw error
    }
  }

  return {
    id: 'opencode',
    invoke,
    stream,
    session,
  }
}

function createClaudeAdapterUnavailableError(): HarnessCapabilityError {
  return new HarnessCapabilityError(
    'claude_agent_sdk adapter is not enabled. Set AGENT_GOVERNANCE_ENABLE_CLAUDE_ADAPTER=true to activate the skeleton.',
    'HARNESS_PROVIDER_DISABLED',
  )
}

function createClaudeAdapterUnimplementedError(): HarnessCapabilityError {
  return new HarnessCapabilityError(
    'claude_agent_sdk adapter skeleton is enabled but runtime methods are not implemented yet.',
    'HARNESS_CAPABILITY_UNAVAILABLE',
  )
}

export function createClaudeAgentSdkHarnessAdapter(): HarnessAdapter {
  const enabled = process.env.AGENT_GOVERNANCE_ENABLE_CLAUDE_ADAPTER === 'true'

  function assertEnabled(): void {
    if (!enabled) {
      throw createClaudeAdapterUnavailableError()
    }
  }

  return {
    id: 'claude_agent_sdk',
    async invoke(): Promise<HarnessInvokeResult> {
      assertEnabled()
      throw createClaudeAdapterUnimplementedError()
    },
    async stream(): Promise<HarnessInvokeResult> {
      assertEnabled()
      throw createClaudeAdapterUnimplementedError()
    },
    async session(): Promise<HarnessSessionResult> {
      assertEnabled()
      throw createClaudeAdapterUnimplementedError()
    },
  }
}

type HarnessAdapterServiceDeps = {
  provider?: string | null
  fallbackProvider?: string | null
  enableProviderFallback?: boolean
}

function defaultProviderFromEnv(): string {
  return process.env.AGENT_GOVERNANCE_HARNESS_PROVIDER ?? 'opencode'
}

function defaultFallbackProviderFromEnv(): string {
  return process.env.AGENT_GOVERNANCE_HARNESS_FALLBACK_PROVIDER ?? 'opencode'
}

function shouldFallback(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error instanceof HarnessCapabilityError) {
    return error.code !== 'HARNESS_PROVIDER_NOT_REGISTERED'
  }
  return true
}

export function createHarnessAdapterService(deps?: HarnessAdapterServiceDeps) {
  const configuredProvider = (deps?.provider ?? defaultProviderFromEnv()).trim() || 'opencode'
  const fallbackProvider = (deps?.fallbackProvider ?? defaultFallbackProviderFromEnv()).trim() || 'opencode'
  const enableProviderFallback = deps?.enableProviderFallback ?? true
  const adapters = new Map<string, HarnessAdapter>()

  function registerAdapter(adapter: HarnessAdapter): void {
    adapters.set(adapter.id, adapter)
  }

  registerAdapter(createOpenCodeHarnessAdapter())
  registerAdapter(createClaudeAgentSdkHarnessAdapter())

  function getActiveProviderId(): string {
    if (adapters.has(configuredProvider)) {
      return configuredProvider
    }
    return 'opencode'
  }

  function getAdapter(providerId?: string | null): HarnessAdapter {
    const resolvedProvider = (providerId ?? getActiveProviderId()).trim()
    const adapter = adapters.get(resolvedProvider)
    if (adapter) return adapter

    throw new HarnessCapabilityError(
      `Harness provider "${resolvedProvider}" is not registered.`,
      'HARNESS_PROVIDER_NOT_REGISTERED',
    )
  }

  async function invoke(input: HarnessInvokeRequest & { providerId?: string | null }): Promise<HarnessInvokeResult> {
    const resolvedProviderId = (input.providerId ?? getActiveProviderId()).trim()
    const adapter = getAdapter(resolvedProviderId)
    try {
      return await adapter.invoke(input)
    } catch (error) {
      const canFallback = !input.providerId && enableProviderFallback && resolvedProviderId !== fallbackProvider
      if (!canFallback || !shouldFallback(error)) {
        throw error
      }
      const fallbackAdapter = getAdapter(fallbackProvider)
      return fallbackAdapter.invoke(input)
    }
  }

  async function stream(
    input: HarnessInvokeRequest & { providerId?: string | null },
    onEvent: (event: HarnessStreamEvent) => Promise<void>,
  ): Promise<HarnessInvokeResult> {
    const resolvedProviderId = (input.providerId ?? getActiveProviderId()).trim()
    const adapter = getAdapter(resolvedProviderId)
    try {
      return await adapter.stream(input, onEvent)
    } catch (error) {
      const canFallback = !input.providerId && enableProviderFallback && resolvedProviderId !== fallbackProvider
      if (!canFallback || !shouldFallback(error)) {
        throw error
      }
      const fallbackAdapter = getAdapter(fallbackProvider)
      return fallbackAdapter.stream(input, onEvent)
    }
  }

  async function session(input: HarnessSessionRequest & { providerId?: string | null }): Promise<HarnessSessionResult> {
    const resolvedProviderId = (input.providerId ?? getActiveProviderId()).trim()
    const adapter = getAdapter(resolvedProviderId)
    try {
      return await adapter.session(input)
    } catch (error) {
      const canFallback = !input.providerId && enableProviderFallback && resolvedProviderId !== fallbackProvider
      if (!canFallback || !shouldFallback(error)) {
        throw error
      }
      const fallbackAdapter = getAdapter(fallbackProvider)
      return fallbackAdapter.session(input)
    }
  }

  function listProviders(): string[] {
    return [...adapters.keys()].sort((a, b) => a.localeCompare(b))
  }

  return {
    registerAdapter,
    getAdapter,
    getActiveProviderId,
    listProviders,
    invoke,
    stream,
    session,
  }
}

export type HarnessAdapterService = ReturnType<typeof createHarnessAdapterService>
