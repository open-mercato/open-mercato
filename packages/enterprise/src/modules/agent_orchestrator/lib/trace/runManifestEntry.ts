import { canonicalJsonStringify } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-definition-hash'
import type { AiAgentPromptResolvedEvent } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-call-contract'
import type { RunObservationSnapshot } from '@open-mercato/shared/lib/ai/run-observation'
import { captureTelemetryTrace } from '@open-mercato/shared/lib/telemetry/runtime'
import type { TraceSpanIngest } from '../../data/validators'
import { DELEGATE_TOOL_ID, type AgentRegistryEntry } from '../sdk/defineAgent'
import { getSkillEntry } from '../sdk/defineSkill'
import { getAgentSkill } from '../runtime/fileAgentSkills'
import type { AgentInvoker, AgentRunCtx } from '../runtime/persistence'
import { resolveAgentDefinitionHash } from './definitionHash'
import {
  RUN_MANIFEST_SPAN_NAME,
  buildRunManifestAttributes,
  computeManifestSha256,
  runManifestExternalSpanId,
  type RunManifestAgentSource,
  type RunManifestInput,
  type RunManifestInvoker,
  type RunManifestRuntime,
  type RunManifestSkill,
} from './runManifest'

export type AgentRunManifestOptions = {
  entry: AgentRegistryEntry
  ctx: Pick<AgentRunCtx, 'userId' | 'runAs' | 'invoker' | 'entryPoint' | 'channel' | 'correlationId'>
  runtime: RunManifestRuntime
  promptResolved?: Pick<AiAgentPromptResolvedEvent, 'systemPrompt' | 'promptOverride' | 'provider' | 'modelId'> | null
  observation?: Pick<RunObservationSnapshot, 'knowledge'> | null
  traceparent?: string | null
}

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

export function resolveManifestAgentSource(entry: AgentRegistryEntry): RunManifestAgentSource {
  return entry.sourceFiles ? 'file' : 'code'
}

export function resolveManifestToolNames(entry: AgentRegistryEntry): string[] {
  const names = new Set(entry.tools)
  for (const skillId of entry.skills) {
    for (const toolId of getSkillEntry(skillId)?.tools ?? []) names.add(toolId)
  }
  if (entry.runtime === 'native' && entry.subAgents.length > 0) names.add(DELEGATE_TOOL_ID)
  return Array.from(names).sort(compareCodePoints)
}

export function computeManifestToolsSha256(toolNames: readonly string[]): string {
  return computeManifestSha256(canonicalJsonStringify([...toolNames].sort(compareCodePoints)))
}

export function resolveManifestSkills(entry: AgentRegistryEntry): RunManifestSkill[] {
  const skills: RunManifestSkill[] = []
  for (const skillId of entry.skills) {
    const codeSkill = getSkillEntry(skillId)
    if (codeSkill) {
      skills.push({
        id: skillId,
        sha256: computeManifestSha256(
          canonicalJsonStringify({ instructions: codeSkill.instructions, tools: codeSkill.tools }),
        ),
      })
      continue
    }
    const fileSkill = getAgentSkill(entry.id, skillId)
    if (fileSkill) {
      skills.push({
        id: skillId,
        sha256: computeManifestSha256(
          canonicalJsonStringify({
            instructions: fileSkill.instructions,
            template: fileSkill.template ?? null,
            examples: fileSkill.examples,
            tools: fileSkill.tools,
            scripts: fileSkill.scripts ?? [],
          }),
        ),
      })
    }
  }
  return skills
}

export function toManifestInvoker(invoker: AgentInvoker): RunManifestInvoker {
  switch (invoker.kind) {
    case 'user':
      return { kind: 'user', userId: invoker.userId, apiKeyId: null, ownerUserId: null }
    case 'api_key':
      return { kind: 'api_key', userId: null, apiKeyId: invoker.apiKeyId, ownerUserId: invoker.ownerUserId ?? null }
    case 'workflow':
      return { kind: 'workflow', userId: invoker.actingUserId, apiKeyId: null, ownerUserId: null }
    case 'agent_token':
      return {
        kind: 'agent_token',
        userId: invoker.agentUserId,
        apiKeyId: null,
        ownerUserId: invoker.onBehalfOfUserId ?? null,
      }
  }
}

export function captureManifestTraceparent(): string | null {
  return captureTelemetryTrace()?.traceparent ?? null
}

export function buildAgentRunManifestInput(options: AgentRunManifestOptions): RunManifestInput {
  const { entry, ctx, promptResolved } = options
  const toolNames = resolveManifestToolNames(entry)
  return {
    runtime: options.runtime,
    agentId: entry.id,
    definitionHash: resolveAgentDefinitionHash(entry),
    agentSource: resolveManifestAgentSource(entry),
    ctx: { userId: ctx.userId },
    promptOverride: promptResolved?.promptOverride ?? null,
    systemPromptSha256: promptResolved ? computeManifestSha256(promptResolved.systemPrompt) : null,
    skills: resolveManifestSkills(entry),
    toolNames,
    toolsSha256: computeManifestToolsSha256(toolNames),
    modelDeclared: entry.defaultModel ?? null,
    modelResolved: promptResolved?.modelId ?? null,
    provider: promptResolved?.provider ?? null,
    observation: options.observation ?? null,
    invoker: ctx.invoker ? toManifestInvoker(ctx.invoker) : null,
    entryPoint: ctx.entryPoint ?? null,
    channel: ctx.channel ?? null,
    correlationId: ctx.correlationId ?? null,
    runAs: ctx.runAs
      ? { agentUserId: ctx.runAs.agentUserId, onBehalfOfUserId: ctx.runAs.onBehalfOfUserId ?? null }
      : null,
    traceparent: options.traceparent ?? null,
  }
}

export function buildRunManifestSpan(input: {
  runId: string
  manifest: RunManifestInput
  sequence: number
  recordedAtMs: number
}): TraceSpanIngest {
  const recordedAt = new Date(input.recordedAtMs).toISOString()
  return {
    externalSpanId: runManifestExternalSpanId(input.runId),
    sequence: input.sequence,
    name: RUN_MANIFEST_SPAN_NAME,
    kind: 'system',
    startedAt: recordedAt,
    endedAt: recordedAt,
    durationMs: 0,
    status: 'ok',
    attributes: buildRunManifestAttributes(input.manifest),
  }
}
