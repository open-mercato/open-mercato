/**
 * Tests for the server-side task-plan SSE injector
 * (`packages/ai-assistant/src/modules/ai_assistant/lib/task-plan-stream.ts`).
 *
 * Covers spec `.ai/specs/2026-05-13-ai-chat-visible-task-plan.md`
 * acceptance criteria:
 *   - runtime-derived labels from tool lifecycle chunks
 *   - agent-authored labels via the safe `meta.update_task_plan` tool
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

function parseInjected(line: string): Record<string, unknown> {
  return JSON.parse(line.replace('data: ', '').trim()) as Record<string, unknown>
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

  it('emits a safe agent-authored plan from meta.update_task_plan input', () => {
    const acc = new TaskPlanAccumulator('turn_test')
    const emitted = acc.handleToolChunk(
      chunk('tool-input-available', {
        toolCallId: 'plan-call',
        toolName: 'meta__update_task_plan',
        input: {
          tasks: [
            {
              id: 'find-products',
              label: 'Find matching products',
              detail: 'Catalog search',
              toolName: 'catalog.search_products',
            },
            {
              label: 'Summarize useful matches',
            },
          ],
        },
      }),
    )
    expect(emitted).toHaveLength(1)
    const parsed = parseInjected(emitted[0]!)
    expect(parsed).toMatchObject({
      type: 'data-agent-task-plan',
      planId: 'turn_test',
      tasks: [
        {
          id: 'find-products',
          label: 'Find matching products',
          detail: 'Catalog search',
          state: 'pending',
          source: 'agent',
        },
        {
          id: 'agent-plan-2',
          label: 'Summarize useful matches',
          state: 'pending',
          source: 'agent',
        },
      ],
    })
  })

  it('drops hidden-reasoning-like agent task labels', () => {
    const acc = new TaskPlanAccumulator('turn_test')
    const emitted = acc.handleToolChunk(
      chunk('tool-input-available', {
        toolCallId: 'plan-call',
        toolName: 'meta.update_task_plan',
        input: {
          tasks: [
            {
              id: 'bad',
              label: '<thinking>inspect tenant data</thinking>',
            },
          ],
        },
      }),
    )
    expect(emitted).toEqual([])
  })

  it('updates an agent-authored step when the mapped tool runs and finishes', () => {
    const acc = new TaskPlanAccumulator('turn_test')
    acc.handleToolChunk(
      chunk('tool-input-available', {
        toolCallId: 'plan-call',
        toolName: 'meta__update_task_plan',
        input: {
          tasks: [
            {
              id: 'catalog-search',
              label: 'Search the catalog',
              toolName: 'catalog.search_products',
            },
          ],
        },
      }),
    )
    const running = acc.handleToolChunk(
      chunk('tool-input-start', {
        toolCallId: 'call-1',
        toolName: 'catalog__search_products',
      }),
    )
    expect(parseInjected(running[0]!)).toMatchObject({
      type: 'data-agent-task-update',
      task: {
        id: 'catalog-search',
        label: 'Search the catalog',
        state: 'running',
        source: 'agent',
        toolCallId: 'call-1',
      },
    })

    const done = acc.handleToolChunk(chunk('tool-output-available', { toolCallId: 'call-1' }))
    expect(parseInjected(done[0]!)).toMatchObject({
      type: 'data-agent-task-update',
      task: {
        id: 'catalog-search',
        label: 'Search the catalog',
        state: 'done',
        source: 'agent',
        toolCallId: 'call-1',
      },
    })
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

  it('injects an agent-authored plan before the meta tool input passthrough', async () => {
    const base = buildSseResponse([
      { type: 'tool-input-start', toolCallId: 'plan-call', toolName: 'meta__update_task_plan' },
      {
        type: 'tool-input-available',
        toolCallId: 'plan-call',
        toolName: 'meta__update_task_plan',
        input: {
          tasks: [
            {
              id: 'search-step',
              label: 'Search matching products',
              toolName: 'catalog.search_products',
            },
          ],
        },
      },
      { type: 'tool-output-available', toolCallId: 'plan-call', output: { ok: true } },
      { type: 'tool-input-start', toolCallId: 'call-1', toolName: 'catalog__search_products' },
    ])
    const wrapped = injectTaskPlanIntoStream(base, 'turn_agent')
    const events = await readEvents(wrapped)
    const planIndex = events.findIndex((e) => e.type === 'data-agent-task-plan')
    const metaInputIndex = events.findIndex(
      (e) => e.type === 'tool-input-available' && e.toolCallId === 'plan-call',
    )
    const domainStartIndex = events.findIndex(
      (e) => e.type === 'tool-input-start' && e.toolCallId === 'call-1',
    )
    expect(planIndex).toBeGreaterThan(-1)
    expect(planIndex).toBeLessThan(metaInputIndex)
    expect(planIndex).toBeLessThan(domainStartIndex)
    expect(events[planIndex]).toMatchObject({
      tasks: [{ id: 'search-step', label: 'Search matching products', source: 'agent' }],
    })
    expect(
      events.some(
        (e) =>
          (e.type === 'data-agent-task-update' || e.type === 'data-agent-task-plan') &&
          JSON.stringify(e).includes('plan-call'),
      ),
    ).toBe(false)
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
