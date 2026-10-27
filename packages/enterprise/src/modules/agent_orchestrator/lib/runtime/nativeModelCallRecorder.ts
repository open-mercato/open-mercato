import { canonicalJsonStringify } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-definition-hash'
import type {
  AiAgentCallObserver,
  AiAgentCallSettings,
  AiAgentModelCallEndEvent,
  AiAgentModelCallStartEvent,
  AiAgentModelCallUsage,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-call-contract'
import { computeManifestSha256 } from '../trace/runManifest'

export type NativeModelCallFidelity = 'exact' | 'reconstructed'

export type NativeModelCallRecord = {
  callId: string
  stepNumber: number
  provider: string
  requestModel: string
  responseModel: string | null
  responseId: string | null
  finishReason: string
  usage: AiAgentModelCallUsage
  callSettings: Omit<AiAgentCallSettings, 'providerOptions'>
  hasProviderOptions: boolean
  latencyMs: number
  startedAtMs: number
  endedAtMs: number
  fidelity: NativeModelCallFidelity
  requestSha256: string
  requestBytes: number
  responseSha256: string
  responseBytes: number
  systemSha256: string | null
  toolsSha256: string | null
  toolCount: number
  messageCount: number
}

type PendingModelCall = Omit<
  NativeModelCallRecord,
  'responseModel' | 'responseId' | 'finishReason' | 'usage' | 'latencyMs' | 'endedAtMs' | 'responseSha256' | 'responseBytes'
>

export type NativeModelCallCollector = {
  observer: Required<Pick<AiAgentCallObserver, 'onModelCallStart' | 'onModelCallEnd'>>
  records(): NativeModelCallRecord[]
}

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function hashCanonical(value: unknown): { sha256: string; bytes: number } {
  const canonical = canonicalJsonStringify(value)
  return { sha256: computeManifestSha256(canonical), bytes: Buffer.byteLength(canonical, 'utf8') }
}

function readToolName(definition: Record<string, unknown>): string {
  return typeof definition.name === 'string' ? definition.name : ''
}

function hashTools(tools: AiAgentModelCallStartEvent['tools']): string | null {
  if (!tools) return null
  const sorted = [...tools].sort((left, right) => compareCodePoints(readToolName(left), readToolName(right)))
  return hashCanonical(sorted).sha256
}

function stripProviderOptions(settings: AiAgentCallSettings): Omit<AiAgentCallSettings, 'providerOptions'> {
  const entries = Object.entries(settings).filter(([key]) => key !== 'providerOptions')
  return Object.fromEntries(entries) as Omit<AiAgentCallSettings, 'providerOptions'>
}

function buildPendingCall(event: AiAgentModelCallStartEvent): PendingModelCall {
  const callSettings = event.callSettings ?? {}
  const request = hashCanonical({
    system: event.system,
    messages: event.messages,
    tools: event.tools,
    responseFormat: event.responseFormat,
    callSettings,
  })
  return {
    callId: event.callId,
    stepNumber: event.stepNumber,
    provider: event.provider,
    requestModel: event.modelId,
    callSettings: stripProviderOptions(callSettings),
    hasProviderOptions: callSettings.providerOptions !== undefined,
    startedAtMs: event.startedAtMs,
    fidelity: event.callerManaged === true ? 'reconstructed' : 'exact',
    requestSha256: request.sha256,
    requestBytes: request.bytes,
    systemSha256: typeof event.system === 'string' ? computeManifestSha256(event.system) : null,
    toolsSha256: hashTools(event.tools),
    toolCount: event.tools?.length ?? 0,
    messageCount: Array.isArray(event.messages) ? event.messages.length : 0,
  }
}

export function createNativeModelCallCollector(): NativeModelCallCollector {
  const pending = new Map<string, PendingModelCall>()
  const completed: NativeModelCallRecord[] = []
  return {
    observer: {
      onModelCallStart(event: AiAgentModelCallStartEvent): void {
        pending.set(event.callId, buildPendingCall(event))
      },
      onModelCallEnd(event: AiAgentModelCallEndEvent): void {
        const started = pending.get(event.callId)
        if (!started) return
        pending.delete(event.callId)
        const response = hashCanonical({ finishReason: event.finishReason, content: event.content })
        completed.push({
          ...started,
          responseModel: event.responseModelId,
          responseId: event.responseId,
          finishReason: event.finishReason,
          usage: { ...event.usage },
          latencyMs: Math.max(0, event.responseTimeMs || event.endedAtMs - started.startedAtMs),
          endedAtMs: event.endedAtMs,
          responseSha256: response.sha256,
          responseBytes: response.bytes,
        })
      },
    },
    records(): NativeModelCallRecord[] {
      return [...completed]
    },
  }
}

export function attachModelCallsToSteps<TStep extends object>(
  steps: TStep[],
  calls: NativeModelCallRecord[],
): { steps: Array<TStep & { call?: NativeModelCallRecord }>; fallbackCall: NativeModelCallRecord | null } {
  return {
    steps: steps.map((step, index) => (calls[index] ? { ...step, call: calls[index] } : step)),
    fallbackCall: calls[steps.length] ?? null,
  }
}
