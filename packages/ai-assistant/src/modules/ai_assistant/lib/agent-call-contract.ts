import { z } from 'zod'

export type AiAgentCallSettings = {
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
  seed?: number
  stopSequences?: string[]
  presencePenalty?: number
  frequencyPenalty?: number
  providerOptions?: Record<string, unknown>
}

export type AiAgentRunChannel = 'chat' | 'playground' | 'run-object' | 'mcp' | 'tools-api' | 'internal'

export type AiAgentRunTraceOptions = {
  persist?: boolean
  channel?: AiAgentRunChannel
  correlationId?: string
}

export type AiAgentPromptResolvedEvent = {
  agentId: string
  systemPrompt: string
  promptOverride: { id: string; version: number } | null
  pageContextHydrated: boolean
  attachmentCount: number
  provider: string | null
  modelId: string | null
}

export type AiAgentModelCallStartEvent = {
  callId: string
  stepNumber: number
  provider: string
  modelId: string
  system: string | undefined
  messages: unknown[]
  tools: ReadonlyArray<Record<string, unknown>> | undefined
  responseFormat: unknown | undefined
  callSettings: AiAgentCallSettings
  startedAtMs: number
  synthesized?: boolean
  callerManaged?: boolean
}

export type AiAgentModelCallUsage = {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
}

export type AiAgentModelCallEndEvent = {
  callId: string
  finishReason: string
  responseId: string | null
  responseModelId: string | null
  usage: AiAgentModelCallUsage
  content: unknown[]
  providerMetadata?: Record<string, unknown>
  responseTimeMs: number
  endedAtMs: number
}

export type AiAgentCallObserver = {
  onPromptResolved?(event: AiAgentPromptResolvedEvent): void | Promise<void>
  onModelCallStart?(event: AiAgentModelCallStartEvent): void | Promise<void>
  onModelCallEnd?(event: AiAgentModelCallEndEvent): void | Promise<void>
}

export const aiAgentCallSettingsSchema = z
  .object({
    temperature: z.number().min(0).optional(),
    topP: z.number().min(0).max(1).optional(),
    topK: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    seed: z.number().int().optional(),
    stopSequences: z.array(z.string().min(1)).optional(),
    presencePenalty: z.number().optional(),
    frequencyPenalty: z.number().optional(),
    providerOptions: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const AI_AGENT_CALL_SETTING_KEYS = [
  'temperature',
  'topP',
  'topK',
  'maxOutputTokens',
  'seed',
  'stopSequences',
  'presencePenalty',
  'frequencyPenalty',
  'providerOptions',
] as const satisfies ReadonlyArray<keyof AiAgentCallSettings>

export const AI_AGENT_HTTP_MAX_OUTPUT_TOKENS = 32_768

export const AI_AGENT_HTTP_MAX_STOP_SEQUENCES = 4

export const AI_AGENT_HTTP_MAX_STOP_SEQUENCE_LENGTH = 64

export const aiAgentHttpCallSettingsSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
    topK: z.number().int().min(1).max(1000).optional(),
    maxOutputTokens: z.number().int().min(1).max(AI_AGENT_HTTP_MAX_OUTPUT_TOKENS).optional(),
    seed: z.number().int().optional(),
    stopSequences: z
      .array(z.string().min(1).max(AI_AGENT_HTTP_MAX_STOP_SEQUENCE_LENGTH))
      .max(AI_AGENT_HTTP_MAX_STOP_SEQUENCES)
      .optional(),
    presencePenalty: z.number().min(-2).max(2).optional(),
    frequencyPenalty: z.number().min(-2).max(2).optional(),
  })
  .strict()

export type AiAgentHttpCallSettings = z.infer<typeof aiAgentHttpCallSettingsSchema>

function pickCallSettings(source: AiAgentCallSettings | undefined): Record<string, unknown> {
  const picked: Record<string, unknown> = {}
  if (!source || typeof source !== 'object') return picked
  const record = source as Record<string, unknown>
  for (const key of AI_AGENT_CALL_SETTING_KEYS) {
    if (record[key] !== undefined) picked[key] = record[key]
  }
  return picked
}

export function mergeCallSettings(
  modelSettings: AiAgentCallSettings | undefined,
  callSettings: AiAgentCallSettings | undefined,
): AiAgentCallSettings {
  return { ...pickCallSettings(modelSettings), ...pickCallSettings(callSettings) } as AiAgentCallSettings
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function mergeProviderOptions(
  baseOptions: Record<string, unknown> | undefined,
  overrideOptions: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!overrideOptions) return baseOptions
  if (!baseOptions) return overrideOptions
  const merged: Record<string, unknown> = { ...baseOptions }
  for (const [providerKey, providerValue] of Object.entries(overrideOptions)) {
    const existing = merged[providerKey]
    merged[providerKey] =
      isPlainRecord(existing) && isPlainRecord(providerValue) ? { ...existing, ...providerValue } : providerValue
  }
  return merged
}

export function toSdkCallSettings(
  settings: AiAgentCallSettings,
  baseProviderOptions?: Record<string, unknown>,
): Omit<AiAgentCallSettings, 'providerOptions'> & { providerOptions?: Record<string, unknown> } {
  const { providerOptions, ...rest } = pickCallSettings(settings) as AiAgentCallSettings
  const mergedProviderOptions = mergeProviderOptions(baseProviderOptions, providerOptions)
  return mergedProviderOptions !== undefined ? { ...rest, providerOptions: mergedProviderOptions } : rest
}
