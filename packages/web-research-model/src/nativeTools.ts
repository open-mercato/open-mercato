export type NativeToolSet = Record<string, unknown>

/**
 * Loads the provider's own web-search tool lazily.
 *
 * The import is dynamic on purpose: this package is statically imported by the
 * generated adapter registry, and a top-level import of a provider SDK the host
 * did not install would fail the whole registry rather than this one adapter.
 * Both provider packages are optional peers for the same reason.
 */
export async function loadNativeSearchTool(
  providerId: string,
  maxUses: number,
): Promise<NativeToolSet | null> {
  if (providerId === 'anthropic') {
    try {
      const { anthropic } = await import('@ai-sdk/anthropic')
      return { web_search: anthropic.tools.webSearch_20250305({ maxUses }) }
    } catch {
      return null
    }
  }
  if (providerId === 'openai') {
    try {
      const { openai } = await import('@ai-sdk/openai')
      return { web_search: openai.tools.webSearch() }
    } catch {
      return null
    }
  }
  if (providerId === 'azure') {
    try {
      // Azure's web search is a Responses API built-in backed by Grounding with
      // Bing. `@ai-sdk/azure` calls the Responses API by default, which is what
      // makes the tool reachable at all — the OpenAI-compatible Chat Completions
      // surface Azure used to be wired through cannot carry it.
      const { azure } = await import('@ai-sdk/azure')
      return { web_search: azure.tools.webSearch() }
    } catch {
      return null
    }
  }
  return null
}
