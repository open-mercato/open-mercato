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

export function mergeCallSettings(
  modelSettings: AiAgentCallSettings | undefined,
  callSettings: AiAgentCallSettings | undefined,
): AiAgentCallSettings {
  const merged: Record<string, unknown> = {}
  for (const source of [modelSettings, callSettings]) {
    if (!source) continue
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) merged[key] = value
    }
  }
  return merged as AiAgentCallSettings
}
