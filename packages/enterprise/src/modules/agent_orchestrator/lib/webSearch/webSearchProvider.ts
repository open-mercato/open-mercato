import type { AwilixContainer } from 'awilix'
import { createSearxngProvider, type WebSearchProvider } from '@open-mercato/web-search'
import { resolveWebSearchConfig, type WebSearchRuntimeConfig } from './config'
import { createModelNativeProvider } from './adapters/modelNativeProvider'
import { createTavilyProvider } from './adapters/tavilyProvider'

/**
 * Resolves the configured search provider (spec 2026-07-11-agent-web-search-tool,
 * Phase 5). `OM_AGENT_WEB_SEARCH_PROVIDER` selects the adapter; the DEFAULT is
 * `model` — the model-native adapter (Flavor B) that reuses the agent's own LLM
 * `web_search`, so search works with no bundled software and no separate key.
 * Returns null when the selection needs config that is absent (keyed provider
 * without a key, SearXNG without a base URL, or `none`) → the tool returns a clean
 * `not_configured` result. Note: `web_fetch` does NOT depend on this — it uses the
 * built-in fetch path regardless of the search provider.
 *
 * `brave`/`exa` are recognized but not yet implemented (resolve to null → operator
 * gets `not_configured`); add their adapters as keyed upgrades when needed.
 */
export function resolveWebSearchProvider(
  container: AwilixContainer,
  config: WebSearchRuntimeConfig = resolveWebSearchConfig(),
): WebSearchProvider | null {
  switch (config.provider) {
    case 'model':
      return createModelNativeProvider(container, {
        maxBytes: config.maxBytes,
        timeoutMs: config.timeoutMs,
      })
    case 'tavily':
      return config.tavilyApiKey
        ? createTavilyProvider({
            apiKey: config.tavilyApiKey,
            defaultLimit: config.maxResults,
            defaultMaxBytes: config.maxBytes,
            defaultTimeoutMs: config.timeoutMs,
          })
        : null
    case 'searxng':
      return config.baseUrl
        ? createSearxngProvider({
            baseUrl: config.baseUrl,
            defaultLimit: config.maxResults,
            defaultMaxBytes: config.maxBytes,
            defaultTimeoutMs: config.timeoutMs,
          })
        : null
    case 'brave':
    case 'exa':
    case 'none':
    default:
      return null
  }
}
