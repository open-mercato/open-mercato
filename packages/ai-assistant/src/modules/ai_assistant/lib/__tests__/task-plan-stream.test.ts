/**
 * Tests for the server-side task-plan SSE injector
 * (`packages/ai-assistant/src/modules/ai_assistant/lib/task-plan-stream.ts`).
 *
 * Covers spec `.ai/specs/2026-05-13-ai-chat-visible-task-plan.md` (Phase 1)
 * acceptance criteria:
 *   - runtime-derived labels from tool lifecycle chunks
 *   - additive `data-agent-task-plan` snapshot + `data-agent-task-update` deltas
 *   - terminal-state ordering safeguard (done/failed/skipped wins over running)
 *   - non-tool chunks are passed through unchanged
 */

// Node 18+ ships TextEncoder/TextDecoder/ReadableStream/Response globally,
// so no jsdom-style polyfills are required for this test. The
// `task-plan-stream` module relies on the same standard web stream APIs.

import {
  TaskPlanAccumulator,
  deriveTaskLabel,
  injectTaskPlanIntoStream,
} from '../task-plan-stream'

function chunk(type: string, extras: Record<string, unknown> = {}): { type: string } & Record<string, unknown> {
  return { type, ...extras }
}

describe('deriveTaskLabel', () => {
  it('humanizes the last tool segment with module prefix', () => {
    expect(deriveTaskLabel('customers__list_people')).toBe('Customers · List people')
  })

  it('falls back to a generic label when name is missing', () => {
    expect(deriveTaskLabel(undefined)).toBe('Tool call')
    expect(deriveTaskLabel('')).toBe('Tool call')
  })

  it('handles unprefixed tool names', () => {
    expect(deriveTaskLabel('search')).toBe('Search')
  })

  it('caps very long names at 80 chars', () => {
    const huge = `module__${'segment_'.repeat(40)}end`
    const label = deriveTaskLabel(huge)
    expect(label.length).toBeLessThanOrEqual(80)
  })
})

describe('TaskPlanAccumulator', () => {
  it('emits an initial snapshot then patches via updates', () => {
    const acc = new TaskPlanAccumulator('turn_test')
    const first = acc.handleToolChunk(
      chunk('tool-input-start', { toolCallId: 'call-1', toolName: 'customers__list_people' }),
    )
    expect(first).toHaveLength(1)
    const firstParsed = JSON.parse(first[0]!.replace('data: ', '').trim())
    expect(firstParsed).toMatchObject({
      type: 'data-agent-task-plan',
      planId: 'turn_test',
      tasks: [
        {
          id: 'call-1',
          label: 'Customers · List people',
          state: 'running',
          source: 'runtime',
          toolCallId: 'call-1',
        },
      ],
    })

    const finishing = acc.handleToolChunk(
      chunk('tool-output-available', { toolCallId: 'call-1' }),
    )
    expect(finishing).toHaveLength(1)
    const finishParsed = JSON.parse(finishing[0]!.replace('data: ', '').trim())
    expect(finishParsed).toMatchObject({
      type: 'data-agent-task-update',
      planId: 'turn_test',
      task: { id: 'call-1', state: 'done' },
    })
  })

  it('emits task-update for a second tool that arrives after the snapshot', () => {
    const acc = new TaskPlanAccumulator('turn_test')
    acc.handleToolChunk(chunk('tool-input-start', { toolCallId: 'call-1', toolName: 'a__first' }))
    const secondStart = acc.handleToolChunk(
      chunk('tool-input-start', { toolCallId: 'call-2', toolName: 'b__second' }),
    )
    expect(secondStart).toHaveLength(1)
    const parsed = JSON.parse(secondStart[0]!.replace('data: ', '').trim())
    expect(parsed.type).toBe('data-agent-task-update')
    expect(parsed.task).toMatchObject({ id: 'call-2', state: 'running' })
  })

  it('keeps terminal state when a later running event arrives out of order', () => {
    const acc = new TaskPlanAccumulator('turn_test')
    acc.handleToolChunk(chunk('tool-input-start', { toolCallId: 'call-1', toolName: 'a__first' }))
    acc.handleToolChunk(chunk('tool-output-available', { toolCallId: 'call-1' }))
    const stale = acc.handleToolChunk(
      chunk('tool-input-available', { toolCallId: 'call-1', toolName: 'a__first', input: {} }),
    )
    const parsed = JSON.parse(stale[0]!.replace('data: ', '').trim())
    // Stream-ordering safeguard: terminal `done` wins over a late `running`.
    expect(parsed.task.state).toBe('done')
  })

  it('marks tool errors as failed', () => {
    const acc = new TaskPlanAccumulator('turn_test')
    acc.handleToolChunk(chunk('tool-input-start', { toolCallId: 'call-1', toolName: 'a__first' }))
    const fail = acc.handleToolChunk(
      chunk('tool-output-error', { toolCallId: 'call-1', errorText: 'boom' }),
    )
    const parsed = JSON.parse(fail[0]!.replace('data: ', '').trim())
    expect(parsed.task.state).toBe('failed')
  })

  it('ignores chunks without a toolCallId', () => {
    const acc = new TaskPlanAccumulator('turn_test')
    expect(acc.handleToolChunk(chunk('tool-input-start'))).toEqual([])
    expect(acc.handleToolChunk(chunk('text-delta', { delta: 'hi' }))).toEqual([])
  })
})

function buildSseResponse(events: Array<Record<string, unknown>>): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const raw = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
      controller.enqueue(encoder.encode(raw))
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'x-vercel-ai-ui-message-stream': 'v1',
    },
  })
}

async function readEvents(response: Response): Promise<Array<Record<string, unknown>>> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events: Array<Record<string, unknown>> = []
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    for (;;) {
      const boundary = buffer.indexOf('\n\n')
      if (boundary === -1) break
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const dataLine = block.split('\n').find((line) => line.startsWith('data: '))
      if (!dataLine) continue
      const payload = dataLine.slice('data: '.length)
      if (payload === '[DONE]') continue
      try {
        events.push(JSON.parse(payload))
      } catch {
        // ignore malformed
      }
    }
  }
  return events
}

describe('injectTaskPlanIntoStream', () => {
  it('passes through original chunks while injecting task-plan events', async () => {
    const base = buildSseResponse([
      { type: 'tool-input-start', toolCallId: 'call-1', toolName: 'catalog__search_products' },
      { type: 'tool-input-available', toolCallId: 'call-1', toolName: 'catalog__search_products', input: { q: 'shoe' } },
      { type: 'tool-output-available', toolCallId: 'call-1', output: { count: 3 } },
      { type: 'text-delta', id: 'text-1', delta: 'Done.' },
    ])
    const wrapped = injectTaskPlanIntoStream(base, 'turn_42')
    const events = await readEvents(wrapped)
    const planEvent = events.find((e) => e.type === 'data-agent-task-plan')
    expect(planEvent).toMatchObject({ planId: 'turn_42' })
    // Snapshot should appear before the first tool-input-start passthrough.
    const planIndex = events.findIndex((e) => e.type === 'data-agent-task-plan')
    const startIndex = events.findIndex((e) => e.type === 'tool-input-start')
    expect(planIndex).toBeLessThan(startIndex)
    // A `done` update should be emitted after the tool-output-available.
    const outputIndex = events.findIndex((e) => e.type === 'tool-output-available')
    const doneUpdateIndex = events.findIndex(
      (e) =>
        e.type === 'data-agent-task-update' &&
        (e.task as { state?: string } | undefined)?.state === 'done',
    )
    expect(doneUpdateIndex).toBeGreaterThan(outputIndex)
    // Text-delta is forwarded unchanged.
    const textEvent = events.find((e) => e.type === 'text-delta')
    expect(textEvent).toMatchObject({ delta: 'Done.' })
  })

  it('does not inject anything when there are no tool events', async () => {
    const base = buildSseResponse([
      { type: 'text-delta', id: 'text-1', delta: 'Hello.' },
      { type: 'reasoning-start' },
      { type: 'reasoning-delta', delta: '...' },
      { type: 'reasoning-end' },
    ])
    const wrapped = injectTaskPlanIntoStream(base, 'turn_43')
    const events = await readEvents(wrapped)
    expect(events.some((e) => e.type === 'data-agent-task-plan')).toBe(false)
    expect(events.some((e) => e.type === 'data-agent-task-update')).toBe(false)
    expect(events.map((e) => e.type)).toEqual([
      'text-delta',
      'reasoning-start',
      'reasoning-delta',
      'reasoning-end',
    ])
  })
})
