/**
 * Covers the provider→tool mapping only.
 *
 * The SDK packages are ESM-only and this suite runs through CJS ts-jest, so a
 * real `await import()` degrades to `require()` and lands in the catch — which
 * is exactly why every provider silently looked like it had no native search
 * here. The modules are mocked so the branch logic is asserted; that the real
 * import resolves is proved at runtime, not by this file.
 */

jest.mock(
  '@ai-sdk/azure',
  () => ({ azure: { tools: { webSearch: () => ({ kind: 'azure-web-search' }) } } }),
  { virtual: true },
)
jest.mock(
  '@ai-sdk/openai',
  () => ({ openai: { tools: { webSearch: () => ({ kind: 'openai-web-search' }) } } }),
  { virtual: true },
)
jest.mock(
  '@ai-sdk/anthropic',
  () => ({
    anthropic: { tools: { webSearch_20250305: () => ({ kind: 'anthropic-web-search' }) } },
  }),
  { virtual: true },
)

import { loadNativeSearchTool } from '../nativeTools'

describe('loadNativeSearchTool', () => {
  it('offers native search on Azure', async () => {
    // Azure has had a Responses API `web_search` built-in for a while, but this
    // returned null for it, so an agent on Foundry was told its provider had no
    // web search at all no matter how capable the deployment was.
    const tools = await loadNativeSearchTool('azure', 3)
    expect(tools).not.toBeNull()
    expect(tools?.web_search).toEqual({ kind: 'azure-web-search' })
  })

  it('offers native search on OpenAI and Anthropic', async () => {
    expect((await loadNativeSearchTool('openai', 3))?.web_search).toEqual({ kind: 'openai-web-search' })
    expect((await loadNativeSearchTool('anthropic', 3))?.web_search).toEqual({
      kind: 'anthropic-web-search',
    })
  })

  it('returns null for a provider that has none', async () => {
    expect(await loadNativeSearchTool('ollama', 3)).toBeNull()
    expect(await loadNativeSearchTool('lm-studio', 3)).toBeNull()
  })
})
