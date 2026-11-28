import { createContainer } from 'awilix'
import { generateText, Output, stepCountIs, tool, wrapLanguageModel } from 'ai'
import { z } from 'zod'
import { createModelFactory, type CreateModelFactoryDependencies } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import {
  buildRecordedToolFixture,
  resolveToolReplayDecision,
  type ToolReplayContext,
  type ToolReplayFixture,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/llm-adapters/tool-replay-context'
import type { EvalMockResolver } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/eval/toolMocks'

type Model = ReturnType<typeof wrapLanguageModel>
type Result = Awaited<ReturnType<Model['doGenerate']>>
export type PlannedCall = { toolName: string; input: Record<string, unknown> }

const usage: Result['usage'] = {
  inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
}

/**
 * A synthetic model that issues the planned tool calls in one step, then
 * answers `{"ok":true}`, and a tool set whose real handler is a spy. Every tool
 * call goes through the production replay seam, as `agent-tools.ts` does.
 */
export function createMockHarness(plan: PlannedCall[]) {
  const counters = { liveModelCalls: 0, liveToolCalls: 0 }
  const model: Model = {
    specificationVersion: 'v4', provider: 'synthetic', modelId: 'synthetic-model', supportedUrls: {},
    async doGenerate() {
      counters.liveModelCalls += 1
      return counters.liveModelCalls % 2 === 1
        ? {
            content: plan.map((call, index) => ({
              type: 'tool-call' as const, toolCallId: `call-${index}`, toolName: call.toolName, input: JSON.stringify(call.input),
            })),
            finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage, warnings: [],
          }
        : { content: [{ type: 'text', text: '{"ok":true}' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }
    },
    async doStream() { throw new Error('Unexpected streaming call') },
  }
  const provider = { id: 'synthetic', defaultModel: 'synthetic-model', resolveApiKey: () => 'synthetic-only', createModel: () => model }
  const recordDeps = { registry: { resolveFirstConfigured: () => provider }, env: {} } as unknown as CreateModelFactoryDependencies
  const replayDeps: CreateModelFactoryDependencies = {
    registry: { resolveFirstConfigured: () => { throw new Error('Offline provider resolution attempted') } }, env: {},
  }
  const toolNames = Array.from(new Set(plan.map((call) => call.toolName)))
  const toolOutputs: Record<string, unknown[]> = {}
  const tools = Object.fromEntries(toolNames.map((name) => [name, tool({
    inputSchema: z.record(z.string(), z.unknown()),
    async execute(args, context) {
      const decision = resolveToolReplayDecision({ toolName: name, args, isMutation: false, toolCallId: context.toolCallId })
      let output: unknown
      if (decision.kind === 'replay') {
        if (decision.fixture.error) throw new Error(`Tool "${name}" failed: ${decision.fixture.error.message}`)
        output = decision.fixture.output
      } else {
        counters.liveToolCalls += 1
        output = { live: name }
        if (decision.kind === 'record') decision.sink(buildRecordedToolFixture(decision.call, { output }))
      }
      ;(toolOutputs[name] ??= []).push(output)
      return output
    },
  })]))
  const invoke = async (offline: boolean) => {
    const resolved = createModelFactory(createContainer(), offline ? replayDeps : recordDeps).resolveModel({ moduleId: 'synthetic' })
    const result = await generateText({
      model: resolved.model as Model, experimental_download: resolved.download, prompt: 'Use the tools and answer ok.',
      output: Output.object({ schema: z.object({ ok: z.boolean() }) }),
      stopWhen: stepCountIs(3), maxRetries: 0, tools,
    })
    return result.output
  }
  return { counters, toolOutputs, invoke }
}

/** The binding `prepareToolBinding` builds for a case with mocks. */
export function mockReplayContext(resolver: EvalMockResolver, fixtures: ToolReplayFixture[]): ToolReplayContext {
  return {
    mode: 'replay',
    fixtures,
    match: 'strict',
    onMiss: 'error',
    observeMiss: (miss) => resolver.observeUnmatched(miss, miss.resolution),
    lookup: resolver.lookup,
    observeHit: (call, source) => {
      if (source === 'fixture') resolver.observeUnmatched(call, 'fixture')
    },
  }
}

export function mockRecordContext(resolver: EvalMockResolver, recorded: ToolReplayFixture[]): ToolReplayContext {
  return {
    mode: 'record',
    sink: (fixture) => {
      recorded.push(fixture)
      resolver.observeUnmatched({ ...fixture, toolCallId: fixture.toolCallId ?? null }, 'live')
    },
    lookup: resolver.lookup,
  }
}
