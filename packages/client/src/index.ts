import createClient, {
  type Client,
  type ClientOptions,
  type HeadersOptions,
  type Middleware,
} from 'openapi-fetch'
import type { paths } from './generated/openapi.types'

export type { paths, components, operations } from './generated/openapi.types'

const DEFAULT_BASE_URL = 'http://localhost:3000/api'

export type MaybePromise<T> = T | Promise<T>
export type AccessTokenInput = string | (() => MaybePromise<string | undefined>)

export type OpenMercatoClientOptions = Pick<ClientOptions, 'Request' | 'querySerializer' | 'bodySerializer' | 'requestInitExt'> & {
  baseUrl?: string
  accessToken?: AccessTokenInput
  fetch?: typeof fetch
  headers?: HeadersOptions
  middleware?: Middleware[]
}

export type OpenMercatoClient = Client<paths> & {
  readonly baseUrl: string
  setAccessToken(token: AccessTokenInput | undefined): void
  getAccessToken(): Promise<string | undefined>
}

function readEnvBaseUrl(): string | undefined {
  const env = typeof process !== 'undefined' && process.env ? process.env : undefined
  if (!env) return undefined
  return (
    env.OPEN_MERCATO_API_BASE_URL ||
    env.NEXT_PUBLIC_API_BASE_URL ||
    env.NEXT_PUBLIC_APP_URL ||
    env.APP_URL ||
    undefined
  )
}

function readWindowBaseUrl(): string | undefined {
  if (typeof window === 'undefined' || !window.location) return undefined
  return `${window.location.origin}/api`
}

function normalizeBaseUrl(candidate?: string): string {
  const source = candidate?.trim() || readEnvBaseUrl() || readWindowBaseUrl() || DEFAULT_BASE_URL
  return source.replace(/\/+$/, '') || '/'
}

function ensureFetch(fetchImpl?: typeof fetch): typeof fetch {
  if (typeof fetchImpl === 'function') return fetchImpl
  if (typeof globalThis.fetch === 'function') return globalThis.fetch
  throw new Error('No fetch implementation available. Pass a `fetch` option when creating the client in non-browser environments.')
}

function normalizeToken(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined

  // Respect callers that already include the auth scheme (e.g., "Bearer", "ApiKey")
  if (/^(bearer|apikey)\s/i.test(trimmed)) {
    return trimmed
  }

  // API keys (omk_xxx.yyy) should use the ApiKey scheme by default
  if (/^omk_[a-z0-9]+\.[a-z0-9]+$/i.test(trimmed)) {
    return `ApiKey ${trimmed}`
  }

  // Fallback to Bearer tokens for everything else
  return `Bearer ${trimmed}`
}

export function createOpenMercatoClient(options: OpenMercatoClientOptions = {}): OpenMercatoClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const fetchImpl = ensureFetch(options.fetch)
  let tokenProvider = options.accessToken

  const resolveAccessToken = async (): Promise<string | undefined> => {
    if (!tokenProvider) return undefined
    const value = typeof tokenProvider === 'function' ? await tokenProvider() : tokenProvider
    return normalizeToken(value)
  }

  const client = createClient<paths>({
    baseUrl,
    headers: options.headers,
    Request: options.Request,
    querySerializer: options.querySerializer,
    bodySerializer: options.bodySerializer,
    requestInitExt: options.requestInitExt,
    fetch: (request) => fetchImpl(request),
  })

  const authMiddleware: Middleware = {
    onRequest: async ({ request }) => {
      const token = await resolveAccessToken()
      if (!token || request.headers.get('authorization')) return
      const headers = new Headers(request.headers)
      headers.set('authorization', token)
      return new Request(request, { headers })
    },
  }

  client.use(authMiddleware)
  if (options.middleware?.length) {
    client.use(...options.middleware)
  }

  const augmented = client as OpenMercatoClient
  Object.defineProperties(augmented, {
    baseUrl: { value: baseUrl, enumerable: true },
  })

  augmented.setAccessToken = (next) => {
    tokenProvider = next ?? undefined
  }

  augmented.getAccessToken = async () => resolveAccessToken()

  return augmented
}
