import { createHash } from 'node:crypto'
import type { RunObservationSnapshot } from '@open-mercato/shared/lib/ai/run-observation'
import { DEFINITION_HASH_PREFIX } from './definitionHash'

export const RUN_MANIFEST_SPAN_NAME = 'run.manifest'
export const RUN_MANIFEST_VERSION = 1
export const RUN_MANIFEST_MAX_CHARS = 4000

export type RunManifestRuntime = 'native' | 'opencode' | 'external'
export type RunManifestAgentSource = 'code' | 'file' | 'ui'
export type RunManifestInvokerKind = 'user' | 'api_key' | 'workflow' | 'agent_token' | 'integration'
export type RunManifestEntryPoint =
  | 'run_api'
  | 'rerun'
  | 'delegate'
  | 'workflow'
  | 'eval'
  | 'ai_assistant'
  | 'tool'
  | 'agent_api'
export type RunManifestChannel = 'chat' | 'playground' | 'run-object' | 'mcp' | 'tools-api' | 'internal'
export type RunManifestCaptureLevel = 'off' | 'metadata' | 'full'
export type RunManifestCaptureSource = 'agent' | 'tenant' | 'deployment'

export type RunManifestInvoker = {
  kind: RunManifestInvokerKind
  userId: string | null
  apiKeyId: string | null
  ownerUserId: string | null
}

export type RunManifestPrincipal = {
  agentPrincipalId?: string | null
  agentUserId: string
  onBehalfOfUserId?: string | null
}

export type RunManifestCapture = {
  level: RunManifestCaptureLevel
  source: RunManifestCaptureSource
  retentionDays: number
  redactPii: boolean
}

export type RunManifestSkill = {
  id: string
  sha256: string
}

export type RunManifestInput = {
  runtime: RunManifestRuntime
  agentId: string
  definitionHash: string
  agentSource: RunManifestAgentSource
  ctx: { userId: string }
  promptOverride?: { id: string; version: number } | null
  systemPromptSha256?: string | null
  skills?: readonly RunManifestSkill[]
  toolsSha256?: string | null
  toolNames?: readonly string[]
  modelDeclared?: string | null
  modelResolved?: string | null
  provider?: string | null
  observation?: Pick<RunObservationSnapshot, 'knowledge'> | null
  invoker?: RunManifestInvoker | null
  entryPoint?: RunManifestEntryPoint | null
  channel?: RunManifestChannel | null
  correlationId?: string | null
  runAs?: RunManifestPrincipal | null
  capture?: Partial<RunManifestCapture> | null
  traceparent?: string | null
  integrityRawOutputKey?: string | null
}

export type RunManifestAttributes = {
  'om.manifest.version': number
  'om.runtime': RunManifestRuntime
  'om.agent.id': string
  'om.agent.definition_hash': string
  'om.agent.source': RunManifestAgentSource
  'om.prompt.override'?: { id: string; version: number }
  'om.prompt.system.sha256'?: string
  'om.skills': RunManifestSkill[]
  'om.tools.sha256'?: string
  'om.tools.names': string[]
  'om.model.declared'?: string
  'om.model.resolved'?: string
  'om.provider'?: string
  'om.knowledge': Record<string, string>
  'om.invoker': RunManifestInvoker
  'om.entry_point'?: RunManifestEntryPoint
  'om.channel'?: RunManifestChannel
  'om.correlation_id': string | null
  'om.principal'?: {
    agentPrincipalId: string | null
    agentUserId: string | null
    onBehalfOfUserId: string | null
  }
  'om.capture'?: RunManifestCapture
  'om.platform_trace'?: { traceparent: string }
  'om.integrity.raw_output_key'?: string
  'om.manifest.truncated'?: true
}

const DEFAULT_CAPTURE: RunManifestCapture = {
  level: 'metadata',
  source: 'deployment',
  retentionDays: 30,
  redactPii: false,
}

const CHANNEL_ENTRY_POINTS: ReadonlySet<RunManifestEntryPoint> = new Set(['ai_assistant', 'tool'])

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

export function runManifestExternalSpanId(runId: string): string {
  return `${runId}:manifest`
}

export function normalizeManifestSha256(value: string): string {
  return value.startsWith(DEFINITION_HASH_PREFIX) ? value : `${DEFINITION_HASH_PREFIX}${value}`
}

export function computeManifestSha256(value: string): string {
  return `${DEFINITION_HASH_PREFIX}${createHash('sha256').update(value).digest('hex')}`
}

export function measureRunManifest(attributes: RunManifestAttributes): number {
  return JSON.stringify(attributes).length
}

function resolveInvoker(input: RunManifestInput): RunManifestInvoker {
  if (input.invoker) {
    return {
      kind: input.invoker.kind,
      userId: input.invoker.userId ?? null,
      apiKeyId: input.invoker.apiKeyId ?? null,
      ownerUserId: input.invoker.ownerUserId ?? null,
    }
  }
  return { kind: 'user', userId: input.ctx.userId, apiKeyId: null, ownerUserId: null }
}

function resolveKnowledge(input: RunManifestInput): Record<string, string> {
  const knowledge = input.observation?.knowledge ?? {}
  const sortedKeys = Object.keys(knowledge).sort(compareCodePoints)
  const result: Record<string, string> = {}
  for (const key of sortedKeys) result[key] = knowledge[key].version
  return result
}

function resolveSkills(input: RunManifestInput): RunManifestSkill[] {
  return (input.skills ?? [])
    .map((skill) => ({ id: skill.id, sha256: normalizeManifestSha256(skill.sha256) }))
    .sort((left, right) => compareCodePoints(left.id, right.id))
}

function resolveToolNames(input: RunManifestInput): string[] {
  return Array.from(new Set(input.toolNames ?? [])).sort(compareCodePoints)
}

function buildUntrimmed(input: RunManifestInput): RunManifestAttributes {
  const attributes: RunManifestAttributes = {
    'om.manifest.version': RUN_MANIFEST_VERSION,
    'om.runtime': input.runtime,
    'om.agent.id': input.agentId,
    'om.agent.definition_hash': normalizeManifestSha256(input.definitionHash),
    'om.agent.source': input.agentSource,
    'om.skills': resolveSkills(input),
    'om.tools.names': resolveToolNames(input),
    'om.knowledge': resolveKnowledge(input),
    'om.invoker': resolveInvoker(input),
    'om.correlation_id': input.correlationId ?? null,
  }
  if (input.capture) attributes['om.capture'] = { ...DEFAULT_CAPTURE, ...input.capture }
  if (input.promptOverride) {
    attributes['om.prompt.override'] = { id: input.promptOverride.id, version: input.promptOverride.version }
  }
  if (input.systemPromptSha256) {
    attributes['om.prompt.system.sha256'] = normalizeManifestSha256(input.systemPromptSha256)
  }
  if (input.toolsSha256) attributes['om.tools.sha256'] = normalizeManifestSha256(input.toolsSha256)
  if (input.modelDeclared) attributes['om.model.declared'] = input.modelDeclared
  if (input.modelResolved) attributes['om.model.resolved'] = input.modelResolved
  if (input.provider) attributes['om.provider'] = input.provider
  if (input.entryPoint) {
    attributes['om.entry_point'] = input.entryPoint
    if (input.channel && CHANNEL_ENTRY_POINTS.has(input.entryPoint)) attributes['om.channel'] = input.channel
  }
  if (input.runAs) {
    attributes['om.principal'] = {
      agentPrincipalId: input.runAs.agentPrincipalId ?? null,
      agentUserId: input.runAs.agentUserId ?? null,
      onBehalfOfUserId: input.runAs.onBehalfOfUserId ?? null,
    }
  }
  if (input.traceparent) attributes['om.platform_trace'] = { traceparent: input.traceparent }
  if (input.integrityRawOutputKey) attributes['om.integrity.raw_output_key'] = input.integrityRawOutputKey
  return attributes
}

function fits(attributes: RunManifestAttributes): boolean {
  return measureRunManifest(attributes) <= RUN_MANIFEST_MAX_CHARS
}

export function buildRunManifestAttributes(input: RunManifestInput): RunManifestAttributes {
  const attributes = buildUntrimmed(input)
  if (fits(attributes)) return attributes
  attributes['om.manifest.truncated'] = true
  const toolNames = attributes['om.tools.names']
  while (toolNames.length > 0 && !fits(attributes)) toolNames.pop()
  const knowledge = attributes['om.knowledge']
  const knowledgeKeysDescending = Object.keys(knowledge).sort((left, right) => compareCodePoints(right, left))
  for (const key of knowledgeKeysDescending) {
    if (fits(attributes)) break
    delete knowledge[key]
  }
  const skills = attributes['om.skills']
  while (skills.length > 0 && !fits(attributes)) skills.pop()
  return attributes
}
