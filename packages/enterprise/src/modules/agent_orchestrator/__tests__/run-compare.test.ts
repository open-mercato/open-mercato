import {
  boundDiffValue,
  diffJsonPaths,
  diffManifests,
  diffRequestContent,
  diffRequestParams,
  diffTextLines,
  readRequestContent,
  requestParamsRecord,
} from '../lib/trace/runCompare'
import { readLlmSpanMetadata } from '../lib/trace/genAiAttributes'
import type { RunManifestView } from '../lib/trace/runManifestView'

describe('diffManifests', () => {
  it('lists only changed manifest fields in key order', () => {
    const left: RunManifestView = {
      'om.agent.id': 'agent.a',
      'om.agent.definition_hash': 'hash-1',
      'om.prompt.override': { id: 'override-1', version: 1 },
      'om.tools.names': ['search', 'lookup'],
    }
    const right: RunManifestView = {
      'om.agent.id': 'agent.a',
      'om.agent.definition_hash': 'hash-2',
      'om.prompt.override': { id: 'override-1', version: 1 },
      'om.tools.names': ['search'],
      'om.provider': 'openai',
    }

    expect(diffManifests(left, right)).toEqual([
      { key: 'om.agent.definition_hash', left: 'hash-1', right: 'hash-2' },
      { key: 'om.provider', left: null, right: 'openai' },
      { key: 'om.tools.names', left: ['search', 'lookup'], right: ['search'] },
    ])
  })

  it('treats object key order as equal and a missing manifest as empty', () => {
    expect(
      diffManifests(
        { 'om.invoker': { kind: 'user', userId: 'u1' } },
        { 'om.invoker': { userId: 'u1', kind: 'user' } },
      ),
    ).toEqual([])
    expect(diffManifests(null, { 'om.runtime': 'native' })).toEqual([
      { key: 'om.runtime', left: null, right: 'native' },
    ])
    expect(diffManifests(null, null)).toEqual([])
  })
})

describe('diffRequestParams', () => {
  it('diffs normalized gen_ai.request.* values', () => {
    const left = readLlmSpanMetadata({
      'gen_ai.request.model': 'gpt-a',
      'gen_ai.request.temperature': '0.2',
      'gen_ai.request.max_tokens': 512,
      'gen_ai.usage.input_tokens': 10,
    })
    const right = readLlmSpanMetadata({
      'gen_ai.request.model': 'gpt-a',
      'gen_ai.request.temperature': 0.7,
      'gen_ai.request.max_tokens': 512,
      'gen_ai.request.seed': 7,
      'gen_ai.usage.input_tokens': 99,
    })

    expect(diffRequestParams(left, right)).toEqual([
      { key: 'gen_ai.request.seed', left: null, right: 7 },
      { key: 'gen_ai.request.temperature', left: 0.2, right: 0.7 },
    ])
  })

  it('returns an empty record for a missing step', () => {
    expect(requestParamsRecord(null)).toEqual({})
    expect(diffRequestParams(null, null)).toEqual([])
  })
})

describe('diffTextLines', () => {
  it('produces an LCS line diff around a changed section', () => {
    const diff = diffTextLines('intro\nbe brief\nrules\noutro', 'intro\nbe thorough\nrules\nextra\noutro')

    expect(diff.changed).toBe(true)
    expect(diff.truncated).toBe(false)
    expect(diff.lines).toEqual([
      { op: 'equal', text: 'intro' },
      { op: 'removed', text: 'be brief' },
      { op: 'added', text: 'be thorough' },
      { op: 'equal', text: 'rules' },
      { op: 'added', text: 'extra' },
      { op: 'equal', text: 'outro' },
    ])
  })

  it('reports identical texts as unchanged and a missing side as all added', () => {
    expect(diffTextLines('same\ntext', 'same\ntext').changed).toBe(false)
    expect(diffTextLines(null, 'one\ntwo').lines).toEqual([
      { op: 'added', text: 'one' },
      { op: 'added', text: 'two' },
    ])
  })

  it('caps lines and characters and marks the diff truncated', () => {
    const long = Array.from({ length: 50 }, (_unused, index) => `line ${index}`).join('\n')
    const byLines = diffTextLines(long, long, { maxLines: 10, maxChars: 100_000 })
    expect(byLines.truncated).toBe(true)
    expect(byLines.lines).toHaveLength(10)

    const byChars = diffTextLines('x'.repeat(500), 'y', { maxLines: 1000, maxChars: 20 })
    expect(byChars.truncated).toBe(true)
    expect(byChars.lines[0]).toEqual({ op: 'removed', text: 'x'.repeat(20) })
  })
})

describe('diffJsonPaths', () => {
  it('reports added, removed and changed paths', () => {
    const diff = diffJsonPaths(
      [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }],
      [{ role: 'user', content: 'hello there', 'x-meta': 1 }],
    )

    expect(diff.changed).toBe(true)
    expect(diff.truncated).toBe(false)
    expect(diff.entries).toEqual([
      { path: '$[0].content', op: 'changed', left: 'hello', right: 'hello there' },
      { path: '$[0]["x-meta"]', op: 'added', right: 1 },
      { path: '$[1]', op: 'removed', left: { role: 'assistant', content: 'hi' } },
    ])
  })

  it('returns no entries for structurally equal values', () => {
    expect(diffJsonPaths({ first: 1, second: [1, 2] }, { second: [1, 2], first: 1 })).toEqual({
      changed: false,
      truncated: false,
      entries: [],
    })
  })

  it('stops descending at maxDepth and keeps diffing siblings', () => {
    const diff = diffJsonPaths(
      { deep: { level: { inner: 1 } }, flat: 1 },
      { deep: { level: { inner: 2 } }, flat: 2 },
      { maxDepth: 2, maxEntries: 50, maxValueChars: 1000 },
    )

    expect(diff.truncated).toBe(true)
    expect(diff.entries.map((entry) => entry.path)).toEqual(['$.deep.level', '$.flat'])
  })

  it('caps the number of entries', () => {
    const left = Array.from({ length: 30 }, (_unused, index) => index)
    const right = left.map((value) => value + 1)
    const diff = diffJsonPaths(left, right, { maxDepth: 8, maxEntries: 5, maxValueChars: 1000 })

    expect(diff.truncated).toBe(true)
    expect(diff.entries).toHaveLength(5)
  })

  it('replaces oversized values with a truncation marker', () => {
    const diff = diffJsonPaths({ text: 'a' }, { text: 'b'.repeat(100) }, { maxDepth: 8, maxEntries: 50, maxValueChars: 20 })

    expect(diff.entries[0]).toEqual({
      path: '$.text',
      op: 'changed',
      left: 'a',
      right: { _truncated: true, originalChars: 102 },
    })
    expect(boundDiffValue('short', 20)).toBe('short')
  })
})

describe('diffRequestContent', () => {
  it('diffs the system prompt, messages and tools of two request artifacts', () => {
    const left = {
      schema: 'om.llm_request.v1',
      system: 'You are helpful.\nAnswer briefly.',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'search', description: null, inputSchema: {} }],
    }
    const right = {
      schema: 'om.llm_request.v1',
      system: 'You are helpful.\nAnswer in detail.',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
    }

    const diff = diffRequestContent(left, right)

    expect(diff.systemPrompt.changed).toBe(true)
    expect(diff.messages.changed).toBe(false)
    expect(diff.tools.entries).toEqual([
      { path: '$[0]', op: 'removed', left: { name: 'search', description: null, inputSchema: {} } },
    ])
  })

  it('reads malformed payloads as empty content', () => {
    expect(readRequestContent('not an object')).toEqual({ system: null, messages: [], tools: [] })
    expect(readRequestContent({ system: 42, messages: 'x', tools: null })).toEqual({
      system: null,
      messages: [],
      tools: [],
    })
  })
})
