import {
  extractStepMeta,
  extractStepToolCalls,
  normalizeToolError,
  type RawStepEvent,
  type ToolCallTimings,
} from '../loop-step-extraction'

describe('extractStepToolCalls — AI SDK 7 shapes', () => {
  it('reads input from toolCalls and output from toolResults matched by toolCallId', () => {
    const raw: RawStepEvent = {
      toolCalls: [
        { toolCallId: 'call-1', toolName: 'customers.list_people', input: { query: 'Taylor' } },
      ],
      toolResults: [
        { toolCallId: 'call-1', toolName: 'customers.list_people', input: { query: 'Taylor' }, output: { records: [{ id: 'p1' }] } },
      ],
    }
    expect(extractStepToolCalls(raw)).toEqual([
      {
        toolCallId: 'call-1',
        toolName: 'customers.list_people',
        args: { query: 'Taylor' },
        result: { records: [{ id: 'p1' }] },
        repairAttempted: false,
        durationMs: null,
      },
    ])
  })

  it('maps tool-error content parts to a normalized error without a stack', () => {
    const failure = new TypeError('record not found')
    const raw: RawStepEvent = {
      toolCalls: [{ toolCallId: 'call-err', toolName: 'catalog.get_product', input: { id: 'x' } }],
      toolResults: [],
      content: [
        { type: 'tool-call', toolCallId: 'call-err', toolName: 'catalog.get_product', input: { id: 'x' } },
        { type: 'tool-error', toolCallId: 'call-err', toolName: 'catalog.get_product', input: { id: 'x' }, error: failure },
      ],
    }
    const [extracted] = extractStepToolCalls(raw)
    expect(extracted.error).toEqual({ code: 'TypeError', message: 'record not found' })
    expect(extracted.result).toBeUndefined()
    expect(JSON.stringify(extracted)).not.toContain('at ')
  })

  it('prefers an error code over the error name', () => {
    const failure = Object.assign(new Error('denied'), { code: 'FORBIDDEN' })
    expect(normalizeToolError(failure)).toEqual({ code: 'FORBIDDEN', message: 'denied' })
  })

  it('normalizes string, empty and primitive error values', () => {
    expect(normalizeToolError('boom')).toEqual({ code: 'unknown', message: 'boom' })
    expect(normalizeToolError(undefined)).toEqual({ code: 'unknown', message: '' })
    expect(normalizeToolError(42)).toEqual({ code: 'unknown', message: '42' })
    expect(normalizeToolError({})).toEqual({ code: 'unknown', message: '' })
  })

  it('treats an invalid dynamic tool call as an error', () => {
    const raw: RawStepEvent = {
      toolCalls: [
        { toolCallId: 'call-bad', toolName: 'missing.tool', input: '{bad', invalid: true, error: { name: 'NoSuchToolError', message: 'no such tool' } },
      ],
    }
    expect(extractStepToolCalls(raw)[0].error).toEqual({ code: 'NoSuchToolError', message: 'no such tool' })
  })

  it('falls back to content tool-result parts when toolResults is absent', () => {
    const raw: RawStepEvent = {
      toolCalls: [{ toolCallId: 'call-2', toolName: 'search.hybrid_search', input: { q: 'x' } }],
      content: [{ type: 'tool-result', toolCallId: 'call-2', output: { hits: 3 } }],
    }
    expect(extractStepToolCalls(raw)[0].result).toEqual({ hits: 3 })
  })

  it('keeps toolResults over content tool-result parts for the same id', () => {
    const raw: RawStepEvent = {
      toolCalls: [{ toolCallId: 'call-3', toolName: 'search.hybrid_search', input: {} }],
      toolResults: [{ toolCallId: 'call-3', output: 'from-tool-results' }],
      content: [{ type: 'tool-result', toolCallId: 'call-3', output: 'from-content' }],
    }
    expect(extractStepToolCalls(raw)[0].result).toBe('from-tool-results')
  })

  it('keeps an explicit undefined input instead of the legacy args', () => {
    const raw: RawStepEvent = {
      toolCalls: [{ toolCallId: 'call-4', toolName: 'meta.describe_agent', input: undefined, args: { legacy: true } }],
    }
    expect(extractStepToolCalls(raw)[0].args).toEqual({})
  })
})

describe('extractStepToolCalls — legacy shapes', () => {
  it('reads args, result and experimental_toToolResultError', () => {
    const raw: RawStepEvent = {
      toolCalls: [
        { toolName: 'search.hybrid_search', args: { q: 'shoes' }, result: { hits: 2 }, startTime: 100, endTime: 145 },
        {
          toolName: 'catalog.update_product',
          args: { id: 'p1' },
          experimental_toToolResultError: { code: 'VALIDATION', message: 'bad price' },
          repairAttempted: true,
        },
      ],
    }
    expect(extractStepToolCalls(raw)).toEqual([
      {
        toolCallId: null,
        toolName: 'search.hybrid_search',
        args: { q: 'shoes' },
        result: { hits: 2 },
        repairAttempted: false,
        durationMs: 45,
      },
      {
        toolCallId: null,
        toolName: 'catalog.update_product',
        args: { id: 'p1' },
        result: undefined,
        error: { code: 'VALIDATION', message: 'bad price' },
        repairAttempted: true,
        durationMs: null,
      },
    ])
  })

  it('defaults missing args to an empty object and missing toolName to unknown', () => {
    const [extracted] = extractStepToolCalls({ toolCalls: [{}] })
    expect(extracted).toEqual({
      toolCallId: null,
      toolName: 'unknown',
      args: {},
      result: undefined,
      repairAttempted: false,
      durationMs: null,
    })
  })

  it('defaults a legacy error without code or message', () => {
    const [extracted] = extractStepToolCalls({
      toolCalls: [{ toolName: 'x.y', experimental_toToolResultError: {} }],
    })
    expect(extracted.error).toEqual({ code: 'unknown', message: '' })
  })

  it('returns an empty list when the step has no tool calls', () => {
    expect(extractStepToolCalls({})).toEqual([])
    expect(extractStepToolCalls({ toolCalls: [], toolResults: [], content: [] })).toEqual([])
  })
})

describe('extractStepToolCalls — mixed and unmatched', () => {
  it('prefers the SDK 7 tool-error part over a legacy error and SDK 7 output over a legacy result', () => {
    const raw: RawStepEvent = {
      toolCalls: [
        {
          toolCallId: 'call-mixed',
          toolName: 'a.b',
          input: { modern: true },
          args: { legacy: true },
          result: 'legacy-result',
          experimental_toToolResultError: { code: 'LEGACY', message: 'legacy' },
        },
      ],
      toolResults: [{ toolCallId: 'call-mixed', output: 'modern-result' }],
      content: [{ type: 'tool-error', toolCallId: 'call-mixed', error: new Error('modern failure') }],
    }
    const [extracted] = extractStepToolCalls(raw)
    expect(extracted.args).toEqual({ modern: true })
    expect(extracted.result).toBe('modern-result')
    expect(extracted.error).toEqual({ code: 'Error', message: 'modern failure' })
  })

  it('falls back to the legacy result when no SDK 7 result matches the call', () => {
    const raw: RawStepEvent = {
      toolCalls: [{ toolCallId: 'call-5', toolName: 'a.b', input: {}, result: 'legacy-result' }],
      toolResults: [{ toolCallId: 'other', output: 'not-mine' }],
    }
    expect(extractStepToolCalls(raw)[0].result).toBe('legacy-result')
  })

  it('appends unmatched results and errors after the reported calls in first-appearance order', () => {
    const raw: RawStepEvent = {
      toolCalls: [{ toolCallId: 'call-a', toolName: 'a.first', input: { n: 1 } }],
      toolResults: [
        { toolCallId: 'call-a', output: 'a-out' },
        { toolCallId: 'orphan-result', toolName: 'b.second', input: { n: 2 }, output: 'b-out' },
      ],
      content: [
        { type: 'tool-error', toolCallId: 'orphan-error', toolName: 'c.third', input: { n: 3 }, error: 'c failed' },
      ],
    }
    expect(extractStepToolCalls(raw)).toEqual([
      { toolCallId: 'call-a', toolName: 'a.first', args: { n: 1 }, result: 'a-out', repairAttempted: false, durationMs: null },
      { toolCallId: 'orphan-result', toolName: 'b.second', args: { n: 2 }, result: 'b-out', repairAttempted: false, durationMs: null },
      {
        toolCallId: 'orphan-error',
        toolName: 'c.third',
        args: { n: 3 },
        result: undefined,
        error: { code: 'unknown', message: 'c failed' },
        repairAttempted: false,
        durationMs: null,
      },
    ])
  })

  it('merges an orphan result and error sharing a toolCallId into one entry', () => {
    const raw: RawStepEvent = {
      toolResults: [{ toolCallId: 'orphan', toolName: 'x.y', output: 'partial' }],
      content: [{ type: 'tool-error', toolCallId: 'orphan', error: 'late failure' }],
    }
    expect(extractStepToolCalls(raw)).toEqual([
      {
        toolCallId: 'orphan',
        toolName: 'x.y',
        args: {},
        result: 'partial',
        error: { code: 'unknown', message: 'late failure' },
        repairAttempted: false,
        durationMs: null,
      },
    ])
  })

  it('ignores results and errors without a toolCallId', () => {
    const raw: RawStepEvent = {
      toolCalls: [{ toolName: 'a.b', input: { q: 1 } }],
      toolResults: [{ output: 'unkeyed' }],
      content: [{ type: 'tool-error', error: 'unkeyed failure' }],
    }
    expect(extractStepToolCalls(raw)).toEqual([
      { toolCallId: null, toolName: 'a.b', args: { q: 1 }, result: undefined, repairAttempted: false, durationMs: null },
    ])
  })

  it('treats an empty toolCallId as missing', () => {
    const raw: RawStepEvent = {
      toolCalls: [{ toolCallId: '', toolName: 'a.b', input: {} }],
      toolResults: [{ toolCallId: '', output: 'ignored' }],
    }
    const extracted = extractStepToolCalls(raw)
    expect(extracted).toHaveLength(1)
    expect(extracted[0].toolCallId).toBeNull()
    expect(extracted[0].result).toBeUndefined()
  })

  it('preserves the SDK order of multiple tool calls regardless of result order', () => {
    const raw: RawStepEvent = {
      toolCalls: [
        { toolCallId: 'call-1', toolName: 'one', input: {} },
        { toolCallId: 'call-2', toolName: 'two', input: {} },
        { toolCallId: 'call-3', toolName: 'three', input: {} },
      ],
      toolResults: [
        { toolCallId: 'call-3', output: 3 },
        { toolCallId: 'call-1', output: 1 },
        { toolCallId: 'call-2', output: 2 },
      ],
    }
    expect(extractStepToolCalls(raw).map((entry) => [entry.toolName, entry.result])).toEqual([
      ['one', 1],
      ['two', 2],
      ['three', 3],
    ])
  })
})

describe('extractStepToolCalls — durations', () => {
  it('uses the timings map when the call has completed', () => {
    const timings: ToolCallTimings = new Map([['call-1', { startedAt: 1000, endedAt: 1250 }]])
    const raw: RawStepEvent = {
      toolCalls: [{ toolCallId: 'call-1', toolName: 'a.b', input: {}, startTime: 0, endTime: 5 }],
    }
    expect(extractStepToolCalls(raw, timings)[0].durationMs).toBe(250)
  })

  it('falls back to legacy startTime/endTime when the timing has no end', () => {
    const timings: ToolCallTimings = new Map([['call-1', { startedAt: 1000 }]])
    const raw: RawStepEvent = {
      toolCalls: [{ toolCallId: 'call-1', toolName: 'a.b', input: {}, startTime: 10, endTime: 30 }],
    }
    expect(extractStepToolCalls(raw, timings)[0].durationMs).toBe(20)
  })

  it('returns null when neither timings nor legacy timestamps are available', () => {
    const timings: ToolCallTimings = new Map([['other', { startedAt: 1, endedAt: 2 }]])
    const raw: RawStepEvent = { toolCalls: [{ toolCallId: 'call-1', toolName: 'a.b', input: {} }] }
    expect(extractStepToolCalls(raw, timings)[0].durationMs).toBeNull()
  })

  it('applies timings to unmatched orphan entries', () => {
    const timings: ToolCallTimings = new Map([['orphan', { startedAt: 5, endedAt: 12 }]])
    const raw: RawStepEvent = { toolResults: [{ toolCallId: 'orphan', output: 'x' }] }
    expect(extractStepToolCalls(raw, timings)[0].durationMs).toBe(7)
  })

  it('clamps negative durations to zero', () => {
    const timings: ToolCallTimings = new Map([['call-1', { startedAt: 50, endedAt: 40 }]])
    const raw: RawStepEvent = { toolCalls: [{ toolCallId: 'call-1', toolName: 'a.b', input: {} }] }
    expect(extractStepToolCalls(raw, timings)[0].durationMs).toBe(0)
  })
})

describe('extractStepMeta', () => {
  it('reads AI SDK 7 usage details, text, finish reason and response model id', () => {
    const raw: RawStepEvent = {
      text: 'Found 2 people.',
      finishReason: 'tool-calls',
      response: { modelId: 'gpt-5-mini-2026' },
      model: { modelId: 'gpt-5-mini' },
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        inputTokenDetails: { cacheReadTokens: 64 },
        outputTokenDetails: { reasoningTokens: 12 },
      },
    }
    expect(extractStepMeta(raw)).toEqual({
      modelId: 'gpt-5-mini-2026',
      finishReason: 'tool-calls',
      text: 'Found 2 people.',
      usage: { inputTokens: 120, outputTokens: 30, cachedInputTokens: 64, reasoningTokens: 12 },
    })
  })

  it('falls back to legacy flat usage fields and the step model id', () => {
    const raw: RawStepEvent = {
      model: { modelId: 'claude-haiku' },
      usage: { inputTokens: 10, outputTokens: 4, cachedInputTokens: 3, reasoningTokens: 1 },
    }
    expect(extractStepMeta(raw)).toEqual({
      modelId: 'claude-haiku',
      finishReason: 'stop',
      text: '',
      usage: { inputTokens: 10, outputTokens: 4, cachedInputTokens: 3, reasoningTokens: 1 },
    })
  })

  it('joins text content parts when the text field is absent', () => {
    const raw: RawStepEvent = {
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'tool-call', toolCallId: 'call-1' },
        { type: 'text', text: 'world' },
      ],
    }
    expect(extractStepMeta(raw).text).toBe('Hello world')
  })

  it('defaults everything when the event is empty', () => {
    expect(extractStepMeta({})).toEqual({
      modelId: 'unknown',
      finishReason: 'stop',
      text: '',
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: null, reasoningTokens: null },
    })
  })
})
