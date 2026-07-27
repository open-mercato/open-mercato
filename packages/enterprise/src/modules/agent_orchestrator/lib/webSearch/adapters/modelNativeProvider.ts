import type { AwilixContainer } from 'awilix'
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import { createModelFactory } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import {
  WebSearchProviderError,
  fetchUrl,
  type ProviderHealth,
  type WebFetchOptions,
  type WebFetchResult,
  type WebSearchOptions,
  type WebSearchProvider,
  type WebSearchResult,
} from '@open-mercato/web-search'

/**
 * DEFAULT provider (Flavor B, spec 2026-07-11-agent-web-search-tool): reuses the
 * agent's OWN LLM provider `web_search` instead of a separate search vendor. Our
 * MCP tool makes a minimal one-shot `generateText` call with the provider-native
 * web-search server tool enabled and maps the returned URL `sources` to results —
 * so search runs on the LLM key the platform already holds, needs no bundled
 * software, and STILL flows through our ACL/guardrails/traces (the call happens
 * inside this tool). Mirrors `lib/eval/llmJudge.ts`'s model-resolution pattern.
 *
 * Only anthropic/openai expose a native web-search server tool here; for any other
 * configured provider (or when no provider/key is configured in this process),
 * `search` throws a typed error the tool maps to a clean `not_configured`/error
 * result — the agent degrades gracefully, it never crashes.
 */
export type ModelNativeConfig = {
  maxUses?: number
  maxBytes?: number
  timeoutMs?: number
}

type GenerateTextTools = Parameters<typeof generateText>[0]['tools']

// The provider-native web-search factories return `ProviderExecutedTool`, which the
// core `ToolSet` type does not structurally accept; cast at the boundary (a typed
// SDK-to-SDK bridge, not an `any`).
function nativeSearchTool(providerId: string, maxUses: number): GenerateTextTools | null {
  if (providerId === 'anthropic') {
    return { web_search: anthropic.tools.webSearch_20250305({ maxUses }) } as GenerateTextTools
  }
  if (providerId === 'openai') {
    return { web_search: openai.tools.webSearch() } as GenerateTextTools
  }
  return null
}

export function createModelNativeProvider(
  container: AwilixContainer,
  config: ModelNativeConfig = {},
): WebSearchProvider {
  const maxUses = config.maxUses ?? 3

  const resolve = () => {
    try {
      return createModelFactory(container).resolveModel({ moduleId: 'agent_orchestrator' })
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'no model provider configured'
      throw new WebSearchProviderError('provider_unhealthy', `model-native search unavailable: ${detail}`)
    }
  }

  return {
    id: 'model-native',
    async search(query: string, opts: WebSearchOptions = {}): Promise<WebSearchResult[]> {
      const resolution = resolve()
      const tools = nativeSearchTool(resolution.providerId, maxUses)
      if (!tools) {
        throw new WebSearchProviderError(
          'unsupported',
          `provider "${resolution.providerId}" has no native web search; configure a keyed provider`,
        )
      }
      const limit = opts.limit ?? 10
      let sources: Array<{ sourceType?: string; url?: string; title?: string }>
      try {
        const result = await generateText({
          model: resolution.model as Parameters<typeof generateText>[0]['model'],
          tools,
          prompt:
            `Search the public web for: ${query}\n` +
            'Use the web_search tool and cite the most relevant, authoritative results.',
        })
        sources = (result.sources ?? []) as typeof sources
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'unknown error'
        throw new WebSearchProviderError('bad_response', `model-native search failed: ${detail}`)
      }

      const seen = new Set<string>()
      const results: WebSearchResult[] = []
      for (const source of sources) {
        if (source.sourceType && source.sourceType !== 'url') continue
        const url = source.url
        if (!url || seen.has(url)) continue
        seen.add(url)
        results.push({ title: source.title ?? url, url, snippet: '' })
        if (results.length >= limit) break
      }
      return results
    },
    fetch(url: string, opts: WebFetchOptions = {}): Promise<WebFetchResult> {
      return fetchUrl(url, {
        maxBytes: opts.maxBytes ?? config.maxBytes,
        ...(opts.timeoutMs ?? config.timeoutMs ? { timeoutMs: opts.timeoutMs ?? config.timeoutMs } : {}),
      })
    },
    async healthCheck(): Promise<ProviderHealth> {
      try {
        const resolution = resolve()
        return nativeSearchTool(resolution.providerId, maxUses)
          ? { ok: true }
          : { ok: false, detail: `provider "${resolution.providerId}" has no native web search` }
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : 'unavailable' }
      }
    },
  }
}
