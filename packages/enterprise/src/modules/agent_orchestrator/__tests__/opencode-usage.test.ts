/** @jest-environment node */
import {
  readOpenCodeMessageUsage,
  recordOpenCodeMessageUsage,
  totalOpenCodeUsage,
  type OpenCodeUsageSink,
} from '../lib/runtime/openCodeUsage'

describe('OpenCode message usage (#6240)', () => {
  it('folds cache reads and writes into input and keeps the read share as the cached subset', () => {
    expect(
      readOpenCodeMessageUsage({
        id: 'msg_1',
        role: 'assistant',
        modelID: 'claude-sonnet-4-5',
        tokens: { input: 96_060, output: 4_789, reasoning: 0, cache: { read: 292_541, write: 0 } },
      }),
    ).toEqual({
      messageId: 'msg_1',
      usage: { inputTokens: 388_601, outputTokens: 4_789, cachedInputTokens: 292_541, modelId: 'claude-sonnet-4-5' },
    })
    expect(
      readOpenCodeMessageUsage({ id: 'msg_2', role: 'assistant', tokens: { input: 10, output: 1, cache: { write: 90 } } })
        ?.usage,
    ).toMatchObject({ inputTokens: 100, cachedInputTokens: 0, modelId: null })
  })

  it('adds reasoning tokens to output — OpenCode excludes them from tokens.output, providers bill them as output', () => {
    expect(
      readOpenCodeMessageUsage({
        id: 'msg_r',
        role: 'assistant',
        modelID: 'gpt-5',
        tokens: { input: 1_000, output: 200, reasoning: 1_800, cache: { read: 0, write: 0 } },
      })?.usage,
    ).toMatchObject({ inputTokens: 1_000, outputTokens: 2_000 })
  })

  it('ignores non-assistant messages, missing ids or tokens, and treats malformed counts as 0', () => {
    expect(readOpenCodeMessageUsage(null)).toBeNull()
    expect(readOpenCodeMessageUsage({ id: 'u', role: 'user', tokens: { input: 5, output: 0 } })).toBeNull()
    expect(readOpenCodeMessageUsage({ role: 'assistant', tokens: { input: 5, output: 0 } })).toBeNull()
    expect(readOpenCodeMessageUsage({ id: 'a', role: 'assistant' })).toBeNull()
    expect(
      readOpenCodeMessageUsage({ id: 'a', role: 'assistant', tokens: { input: -4, output: 'x', cache: { read: Number.NaN } } })
        ?.usage,
    ).toMatchObject({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 })
  })

  it('keeps only the latest emission per message and sums across messages', () => {
    const sink: OpenCodeUsageSink = new Map()
    recordOpenCodeMessageUsage(sink, { id: 'm1', role: 'assistant', tokens: { input: 1, output: 1 } })
    recordOpenCodeMessageUsage(sink, { id: 'm1', role: 'assistant', tokens: { input: 10, output: 5, cache: { read: 90 } } })
    recordOpenCodeMessageUsage(sink, { id: 'm2', role: 'assistant', modelID: 'gpt-5', tokens: { input: 20, output: 2 } })
    expect(totalOpenCodeUsage(sink)).toEqual({ inputTokens: 120, outputTokens: 7, cachedInputTokens: 90, modelId: 'gpt-5' })
  })

  it('reports nothing when no message carried tokens', () => {
    const sink: OpenCodeUsageSink = new Map()
    expect(totalOpenCodeUsage(sink)).toBeNull()
    recordOpenCodeMessageUsage(sink, { id: 'm1', role: 'assistant', tokens: { input: 0, output: 0 } })
    expect(totalOpenCodeUsage(sink)).toBeNull()
  })
})
