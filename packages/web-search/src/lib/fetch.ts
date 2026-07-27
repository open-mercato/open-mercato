import { WebSearchProviderError } from './errors'
import { extractTitle, htmlToText } from './html-to-text'
import { assertPublicUrl, type LookupFn } from './ssrf'
import type { WebFetchOptions, WebFetchResult } from './types'

const DEFAULT_MAX_BYTES = 64 * 1024
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 5

export type FetchDeps = {
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch
  /** Injectable DNS lookup for the SSRF guard; defaults to node:dns. */
  lookup?: LookupFn
}

/**
 * Provider-independent web fetch: retrieve one public URL and return readable
 * text, size-capped. Always-on SSRF guard runs at the socket boundary (private/
 * metadata targets blocked, redirects re-validated per hop). Shared by every
 * provider's `fetch()` and by the `web_fetch` tool directly — it needs NO search
 * provider, which is why fetch works even when search is unconfigured.
 */
export async function fetchUrl(
  rawUrl: string,
  opts: WebFetchOptions = {},
  deps: FetchDeps = {},
): Promise<WebFetchResult> {
  const fetchFn = deps.fetchFn ?? fetch
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let currentUrl = (await assertPublicUrl(rawUrl, { lookup: deps.lookup })).toString()

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await httpRequest(fetchFn, currentUrl, { timeoutMs, redirect: 'manual' })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) {
        throw new WebSearchProviderError('bad_response', 'Redirect response without a Location header')
      }
      const nextUrl = new URL(location, currentUrl)
      currentUrl = (await assertPublicUrl(nextUrl.toString(), { lookup: deps.lookup })).toString()
      continue
    }
    if (!response.ok) {
      throw new WebSearchProviderError('bad_response', `Fetch failed with status ${response.status}`)
    }
    const { text: body, truncated } = await readCappedText(response, maxBytes)
    const title = extractTitle(body)
    return {
      url: currentUrl,
      ...(title ? { title } : {}),
      text: htmlToText(body),
      truncated,
    }
  }
  throw new WebSearchProviderError('too_many_redirects', `Exceeded ${MAX_REDIRECTS} redirects`)
}

/** Shared timeout-bounded request; maps abort/errors to typed WebSearchProviderError. */
export async function httpRequest(
  fetchFn: typeof fetch,
  url: string,
  options: { timeoutMs?: number; redirect?: RequestRedirect } = {},
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    return await fetchFn(url, { signal: controller.signal, redirect: options.redirect ?? 'follow' })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new WebSearchProviderError('timeout', `Request to ${url} timed out`)
    }
    const detail = err instanceof Error ? err.message : 'Unknown error'
    throw new WebSearchProviderError('bad_response', `Request to ${url} failed: ${detail}`)
  } finally {
    clearTimeout(timeout)
  }
}

export async function readCappedText(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const body = response.body
  if (!body) {
    const full = await response.text()
    const encoded = new TextEncoder().encode(full)
    if (encoded.byteLength <= maxBytes) return { text: full, truncated: false }
    return { text: new TextDecoder().decode(encoded.slice(0, maxBytes)), truncated: true }
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  let truncated = false
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      const remaining = maxBytes - received
      if (value.byteLength > remaining) {
        chunks.push(value.slice(0, remaining))
        received += remaining
        truncated = true
        break
      }
      chunks.push(value)
      received += value.byteLength
    }
    if (!truncated) {
      const { done } = await reader.read()
      if (!done) truncated = true
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  const merged = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { text: new TextDecoder().decode(merged), truncated }
}
