/**
 * Observability Phase 0 spike: pins the AI SDK call-level hook contract that
 * the model-call observer relies on. `generateText` must fire
 * `onLanguageModelCallStart` / `onLanguageModelCallEnd` exactly once per step
 * of a tool loop, after `prepareStep` has narrowed the step's active tools.
 */
import {
  generateText,
  stepCountIs,
  tool,
  type LanguageModelCallEndEvent,
  type LanguageModelCallStartEvent,
} from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'

function buildUsage(inputTokens: number, outputTokens: number) {
  return {
    inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: undefined },
  }
}

function buildScriptedModel() {
  return new MockLanguageModelV4({
    provider: 'spike-provider',
    modelId: 'spike-model',
    doGenerate: [
      {
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-lookup',
            toolName: 'lookup_record',
            input: JSON.stringify({ recordId: 'rec-1' }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_use' },
        usage: buildUsage(11, 3),
        warnings: [],
      },
      {
        content: [{ type: 'text', text: 'Record rec-1 is active.' }],
        finishReason: { unified: 'stop', raw: 'end_turn' },
        usage: buildUsage(17, 5),
        warnings: [],
      },
    ],
  })
}

function buildTools() {
  return {
    lookup_record: tool({
      description: 'Look up a record by id',
      inputSchema: z.object({ recordId: z.string() }),
      execute: async ({ recordId }: { recordId: string }) => ({ recordId, status: 'active' }),
    }),
    update_record: tool({
      description: 'Update a record',
      inputSchema: z.object({ recordId: z.string() }),
      execute: async ({ recordId }: { recordId: string }) => ({ recordId, updated: true }),
    }),
  }
}

function toolNamesOf(event: LanguageModelCallStartEvent): string[] {
  return (event.tools ?? [])
    .map((definition) => definition.name)
    .filter((name): name is string => typeof name === 'string')
    .sort()
}

describe('AI SDK call-level hooks (observability spike)', () => {
  it('fires one start/end pair per tool-loop step after prepareStep applies', async () => {
    const order: string[] = []
    const startEvents: LanguageModelCallStartEvent[] = []
    const endEvents: LanguageModelCallEndEvent[] = []

    const result = await generateText({
      model: buildScriptedModel(),
      tools: buildTools(),
      prompt: 'Check record rec-1',
      temperature: 0.2,
      maxOutputTokens: 256,
      stopWhen: stepCountIs(5),
      prepareStep: ({ stepNumber }) => {
        order.push(`prepareStep:${stepNumber}`)
        return stepNumber === 0
          ? { activeTools: ['lookup_record'] }
          : { activeTools: ['update_record'] }
      },
      onLanguageModelCallStart: (event) => {
        order.push('callStart')
        startEvents.push(event)
      },
      onLanguageModelCallEnd: (event) => {
        order.push('callEnd')
        endEvents.push(event)
      },
    })

    expect(result.steps).toHaveLength(2)
    expect(startEvents).toHaveLength(2)
    expect(endEvents).toHaveLength(2)
    expect(order).toEqual([
      'prepareStep:0',
      'callStart',
      'callEnd',
      'prepareStep:1',
      'callStart',
      'callEnd',
    ])

    expect(toolNamesOf(startEvents[0])).toEqual(['lookup_record'])
    expect(toolNamesOf(startEvents[1])).toEqual(['update_record'])

    for (const event of startEvents) {
      expect(event.provider).toBe('spike-provider')
      expect(event.modelId).toBe('spike-model')
      expect(typeof event.callId).toBe('string')
      expect(event.temperature).toBe(0.2)
      expect(event.maxOutputTokens).toBe(256)
      expect(Array.isArray(event.messages)).toBe(true)
    }
    expect(startEvents[0].callId).toBe(endEvents[0].callId)

    expect(endEvents[0].finishReason).toBe('tool-calls')
    expect(endEvents[1].finishReason).toBe('stop')
    expect(endEvents[0].usage.inputTokens).toBe(11)
    expect(endEvents[1].usage.outputTokens).toBe(5)
    expect(endEvents[0].content.some((part) => part.type === 'tool-call')).toBe(true)
    expect(typeof endEvents[1].performance.responseTimeMs).toBe('number')
  })
})
