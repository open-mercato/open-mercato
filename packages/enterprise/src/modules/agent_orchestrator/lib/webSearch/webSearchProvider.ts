import { createSearxngProvider, type WebSearchProvider } from '@open-mercato/search-provider-searxng'
import { resolveWebSearchConfig } from './config'

/**
 * Builds the default web-search provider (self-hosted SearXNG) from env config.
 * Returns null when no base URL is configured — the tools then return a clean
 * `not_configured` result instead of failing the run. A test/enterprise override
 * can re-register `webSearchProvider` in the container with its own instance.
 */
export function resolveDefaultWebSearchProvider(): WebSearchProvider | null {
  const config = resolveWebSearchConfig()
  if (!config.baseUrl) return null
  return createSearxngProvider({
    baseUrl: config.baseUrl,
    defaultLimit: config.maxResults,
    defaultMaxBytes: config.maxBytes,
    defaultTimeoutMs: config.timeoutMs,
  })
}
