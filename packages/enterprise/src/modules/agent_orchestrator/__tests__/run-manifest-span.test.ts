import { z } from 'zod'
import {
  registerTelemetryRuntime,
  resetTelemetryRuntime,
  type TelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'
import { buildNativeTracePayload, type NativeStepRecord } from '../lib/runtime/nativeTraceCapture'
import { registerAgentSkills, clearAgentSkills } from '../lib/runtime/fileAgentSkills'
import type { AgentRegistryEntry } from '../lib/sdk/defineAgent'
import { resolveAgentDefinitionHash } from '../lib/trace/definitionHash'
import { RUN_MANIFEST_SPAN_NAME, computeManifestSha256, type RunManifestAttributes } from '../lib/trace/runManifest'
import {
  buildAgentRunManifestInput,
  buildRunManifestSpan,
  captureManifestTraceparent,
  computeManifestToolsSha256,
} from '../lib/trace/runManifestEntry'

const RUN_ID = '018f6f2a-0000-4000-8000-0000000000aa'
const USER_ID = '018f6f2a-0000-4000-8000-0000000000bb'
const AGENT_USER_ID = '018f6f2a-0000-4000-8000-0000000000cc'
const T0 = Date.parse('2026-10-26T10:00:00.000Z')

const STEPS: NativeStepRecord[] = [
  {
    modelId: 'gpt-5-mini',
    finishReason: 'tool-calls',
    usage: { inputTokens: 10, outputTokens: 2 },
    toolCalls: [{ toolName: 'customers.get_deal', args: { id: 'd1' }, result: { ok: true }, durationMs: 5 }],
    endedAtMs: T0 + 100,
  },
]

function codeAgent(): AgentRegistryEntry {
  return {
    id: 'manifest_test.code_agent',
    moduleId: 'manifest_test',
    resultKind: 'research',
    schema: z.object({ kind: z.literal('research') }),
    tools: ['customers.get_deal', 'customers.list_deals'],
    skills: [],
    subAgents: [],
    label: 'Manifest code agent',
    description: 'Code agent for manifest tests.',
    instructions: 'inform',
    defaultModel: 'gpt-5-mini',
    runtime: 'native',
  }
}

function fileAgent(): AgentRegistryEntry {
  return {
    ...codeAgent(),
    id: 'manifest_test.file_agent',
    tools: ['customers.get_deal'],
    skills: ['stage_playbook'],
    defaultModel: 'claude-sonnet-4-5',
    runtime: 'opencode',
    sourceFiles: [{ path: 'AGENT.md', content: 'agent body', inContext: true }] as AgentRegistryEntry['sourceFiles'],
  }
}

function manifestOf(spans: ReadonlyArray<{ name: string; attributes?: unknown }>): RunManifestAttributes {
  const manifest = spans.find((span) => span.name === RUN_MANIFEST_SPAN_NAME)
  expect(manifest).toBeDefined()
  return manifest?.attributes as RunManifestAttributes
}

function telemetryRuntime(traceparent: string): TelemetryRuntime {
  return {
    canUseGlobalTracePropagation: () => true,
    captureTraceContext: () => ({ traceparent }),
    continueTrace: (_carrier, _name, fn) => fn(),
    recordHttpDuration: () => {},
    reportError: () => {},
    shutdown: async () => {},
  }
}

afterEach(() => {
  resetTelemetryRuntime()
  clearAgentSkills()
})

describe('native trace payload with a run manifest', () => {
  it('appends exactly one run.manifest system span after the step spans', () => {
    const entry = codeAgent()
    const payload = buildNativeTracePayload({
      runId: RUN_ID,
      agentId: entry.id,
      steps: STEPS,
      startedAtMs: T0,
      endedAtMs: T0 + 150,
      manifest: buildAgentRunManifestInput({
        entry,
        ctx: { userId: USER_ID },
        runtime: 'native',
        promptResolved: {
          systemPrompt: 'You are a deal analyst.',
          promptOverride: { id: 'override-1', version: 4 },
          provider: 'openai',
          modelId: 'gpt-5-mini',
        },
        observation: { knowledge: { 'rules.rule_set': { version: '2026-10-20.3' } } },
      }),
    })

    const spans = payload.spans ?? []
    const manifestSpans = spans.filter((span) => span.name === RUN_MANIFEST_SPAN_NAME)
    expect(manifestSpans).toHaveLength(1)
    expect(manifestSpans[0]).toMatchObject({
      externalSpanId: `${RUN_ID}:manifest`,
      kind: 'system',
      status: 'ok',
      sequence: spans.length - 1,
      durationMs: 0,
    })
    expect(spans.filter((span) => span.kind !== 'system').map((span) => span.kind)).toEqual(['llm', 'tool'])

    const attributes = manifestOf(spans)
    expect(attributes['om.runtime']).toBe('native')
    expect(attributes['om.agent.id']).toBe(entry.id)
    expect(attributes['om.agent.source']).toBe('code')
    expect(attributes['om.agent.definition_hash']).toBe(resolveAgentDefinitionHash(entry))
    expect(attributes['om.prompt.override']).toEqual({ id: 'override-1', version: 4 })
    expect(attributes['om.prompt.system.sha256']).toBe(computeManifestSha256('You are a deal analyst.'))
    expect(attributes['om.tools.names']).toEqual(['customers.get_deal', 'customers.list_deals'])
    expect(attributes['om.tools.sha256']).toBe(
      computeManifestToolsSha256(['customers.list_deals', 'customers.get_deal']),
    )
    expect(attributes['om.model.declared']).toBe('gpt-5-mini')
    expect(attributes['om.model.resolved']).toBe('gpt-5-mini')
    expect(attributes['om.provider']).toBe('openai')
    expect(attributes['om.knowledge']).toEqual({ 'rules.rule_set': '2026-10-20.3' })
    expect(attributes['om.invoker']).toEqual({ kind: 'user', userId: USER_ID, apiKeyId: null, ownerUserId: null })
    expect(attributes['om.principal']).toBeUndefined()
    expect(attributes['om.platform_trace']).toBeUndefined()
  })

  it('keeps the synthetic llm span first for a toolless run and adds the manifest after it', () => {
    const entry = codeAgent()
    const payload = buildNativeTracePayload({
      runId: RUN_ID,
      agentId: entry.id,
      steps: [],
      startedAtMs: T0,
      endedAtMs: T0 + 80,
      fallbackModel: 'gpt-5-mini',
      manifest: buildAgentRunManifestInput({ entry, ctx: { userId: USER_ID }, runtime: 'native' }),
    })
    const spans = payload.spans ?? []
    expect(spans.map((span) => [span.kind, span.sequence])).toEqual([
      ['llm', 0],
      ['system', 1],
    ])
    expect(spans[0].externalSpanId).toBe(`${RUN_ID}:0`)
  })

  it('writes no manifest span when the run carries no manifest', () => {
    const payload = buildNativeTracePayload({
      runId: RUN_ID,
      agentId: 'manifest_test.code_agent',
      steps: STEPS,
      startedAtMs: T0,
      endedAtMs: T0 + 150,
    })
    expect((payload.spans ?? []).some((span) => span.name === RUN_MANIFEST_SPAN_NAME)).toBe(false)
  })

  it('records the bound principal and the platform traceparent when telemetry is on', () => {
    expect(captureManifestTraceparent()).toBeNull()
    registerTelemetryRuntime(telemetryRuntime('00-trace-span-01'))
    const span = buildRunManifestSpan({
      runId: RUN_ID,
      sequence: 3,
      recordedAtMs: T0,
      manifest: buildAgentRunManifestInput({
        entry: codeAgent(),
        ctx: { userId: USER_ID, runAs: { agentUserId: AGENT_USER_ID, onBehalfOfUserId: USER_ID } },
        runtime: 'native',
        traceparent: captureManifestTraceparent(),
      }),
    })
    const attributes = span.attributes as RunManifestAttributes
    expect(attributes['om.platform_trace']).toEqual({ traceparent: '00-trace-span-01' })
    expect(attributes['om.principal']).toEqual({
      agentPrincipalId: null,
      agentUserId: AGENT_USER_ID,
      onBehalfOfUserId: USER_ID,
    })
  })
})

describe('OpenCode run manifest input', () => {
  it('carries the declared model and file skills but no resolved model or provider', () => {
    registerAgentSkills('manifest_test.file_agent', [
      { id: 'stage_playbook', instructions: 'Follow the playbook.', examples: [], tools: [] },
    ])
    const entry = fileAgent()
    const span = buildRunManifestSpan({
      runId: RUN_ID,
      sequence: 0,
      recordedAtMs: T0,
      manifest: buildAgentRunManifestInput({ entry, ctx: { userId: USER_ID }, runtime: 'opencode' }),
    })
    const attributes = span.attributes as RunManifestAttributes
    expect(attributes['om.runtime']).toBe('opencode')
    expect(attributes['om.agent.source']).toBe('file')
    expect(attributes['om.agent.definition_hash']).toBe(resolveAgentDefinitionHash(entry))
    expect(attributes['om.model.declared']).toBe('claude-sonnet-4-5')
    expect(attributes).not.toHaveProperty('om.model.resolved')
    expect(attributes).not.toHaveProperty('om.provider')
    expect(attributes).not.toHaveProperty('om.prompt.system.sha256')
    expect(attributes['om.skills']).toHaveLength(1)
    expect(attributes['om.skills'][0].id).toBe('stage_playbook')
    expect(attributes['om.skills'][0].sha256).toMatch(/^sha256:[0-9a-f]+$/)
  })
})
