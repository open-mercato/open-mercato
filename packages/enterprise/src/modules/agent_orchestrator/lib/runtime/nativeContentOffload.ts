import { createLogger } from '@open-mercato/shared/lib/logger'
import { mapWithConcurrency } from '@open-mercato/shared/lib/query/bounded-decrypt'
import {
  AGENT_TRACE_CONTENT_NAMESPACE,
  ARTIFACT_REFS,
  putArtifact,
  type ArtifactEncryptionRef,
  type ArtifactScope,
} from '../trace/artifactStore'
import { buildLlmRequestArtifact, buildLlmResponseArtifact, type ContentRedaction } from '../trace/contentCapture'
import type { NativeModelCallContentOutcome, NativeModelCallRecord } from './nativeModelCallRecorder'

const logger = createLogger('agent_orchestrator').child({ component: 'native-content-offload' })

export const CONTENT_UPLOAD_CONCURRENCY = 4

type MinimalContainer = {
  resolve<T = unknown>(name: string): T
  hasRegistration?: (name: string) => boolean
}

export type ContentOffloadOptions = {
  redactPii: boolean
}

type PreparedCall = {
  request: { ref: ArtifactEncryptionRef; payload: unknown }
  response: { ref: ArtifactEncryptionRef; payload: unknown }
  truncated: boolean
  redactions: ContentRedaction[]
}

type UploadTask = { callIndex: number; part: 'request' | 'response'; ref: ArtifactEncryptionRef; payload: unknown }

export function withoutContent(call: NativeModelCallRecord): NativeModelCallRecord {
  if (call.content === undefined) return call
  const stripped = { ...call }
  delete stripped.content
  return stripped
}

function mergeRedactions(groups: ContentRedaction[][]): ContentRedaction[] {
  const counts = new Map<string, number>()
  for (const group of groups) {
    for (const entry of group) counts.set(entry.rule, (counts.get(entry.rule) ?? 0) + entry.count)
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([rule, count]) => ({ rule, count }))
}

function prepareCall(call: NativeModelCallRecord, options: ContentOffloadOptions): PreparedCall | null {
  if (!call.content) return null
  try {
    const request = buildLlmRequestArtifact(call.content.request, { redactPii: options.redactPii })
    const response = buildLlmResponseArtifact(call.content.response, { redactPii: options.redactPii })
    return {
      request: { ref: ARTIFACT_REFS.llmRequest, payload: request.payload },
      response: { ref: ARTIFACT_REFS.llmResponse, payload: response.payload },
      truncated: request.truncated || response.truncated,
      redactions: mergeRedactions([request.redactions, response.redactions]),
    }
  } catch (error) {
    logger.warn('llm content artifact build failed', {
      callId: call.callId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function resolveOutcome(
  prepared: PreparedCall | null,
  requestKey: string | null,
  responseKey: string | null,
): NativeModelCallContentOutcome {
  const redactions = prepared?.redactions ?? []
  if (!prepared || !requestKey || !responseKey) {
    return { status: 'storage_unavailable', requestKey, responseKey, redactions }
  }
  return { status: prepared.truncated ? 'over_cap_truncated' : 'stored', requestKey, responseKey, redactions }
}

async function uploadTask(
  container: MinimalContainer,
  scope: ArtifactScope,
  task: UploadTask,
): Promise<string | null> {
  try {
    return await putArtifact(container, scope, task.ref, task.payload, AGENT_TRACE_CONTENT_NAMESPACE)
  } catch {
    return null
  }
}

/**
 * Builds the redacted, capped request/response artifacts of every model call
 * that retained content, uploads them to the trace content namespace with
 * bounded concurrency and returns the calls without their content, each with
 * the offload outcome. Never throws: a failed upload yields
 * `storage_unavailable` for that call.
 */
export async function offloadModelCallContent(
  container: MinimalContainer,
  scope: ArtifactScope,
  calls: NativeModelCallRecord[],
  options: ContentOffloadOptions,
): Promise<NativeModelCallRecord[]> {
  const prepared = calls.map((call) => prepareCall(call, options))
  const tasks: UploadTask[] = []
  prepared.forEach((entry, callIndex) => {
    if (!entry) return
    tasks.push({ callIndex, part: 'request', ref: entry.request.ref, payload: entry.request.payload })
    tasks.push({ callIndex, part: 'response', ref: entry.response.ref, payload: entry.response.payload })
  })
  const keys = await mapWithConcurrency(tasks, CONTENT_UPLOAD_CONCURRENCY, (task) =>
    uploadTask(container, scope, task),
  )
  const keysByCall = new Map<number, { request: string | null; response: string | null }>()
  tasks.forEach((task, index) => {
    const entry = keysByCall.get(task.callIndex) ?? { request: null, response: null }
    entry[task.part] = keys[index]
    keysByCall.set(task.callIndex, entry)
  })
  return calls.map((call, callIndex) => {
    if (!call.content) return call
    const callKeys = keysByCall.get(callIndex) ?? { request: null, response: null }
    return {
      ...withoutContent(call),
      contentOutcome: resolveOutcome(prepared[callIndex], callKeys.request, callKeys.response),
    }
  })
}
