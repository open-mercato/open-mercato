export type HttpMethod = 'GET' | 'POST'

export type HttpRequestInit = {
  readonly method?: HttpMethod
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
  readonly maxBytes?: number
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  /**
   * Content-type prefixes the caller can handle. A response outside the list is
   * rejected with `unsupported_content_type` instead of being decoded as text —
   * without this a PDF or image comes back as mojibake the model then tries to read.
   */
  readonly accept?: readonly string[]
}

export type HttpResponse = {
  /** Final URL after redirects, each of which was re-vetted. */
  readonly url: string
  readonly status: number
  readonly headers: ReadonlyMap<string, string>
  readonly contentType: string | null
  readonly body: string
  readonly truncated: boolean
}

/**
 * The single egress path. Adapters receive one of these and must never reach for
 * `fetch` themselves — the SSRF guard, DNS pinning, redirect re-validation, byte
 * caps and politeness live here, and a bypass silently loses all of them.
 */
export interface HttpClient {
  request(url: string, init?: HttpRequestInit): Promise<HttpResponse>
}

export type Logger = {
  debug(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

const noop = (): void => {}

export const silentLogger: Logger = { debug: noop, info: noop, warn: noop, error: noop }
