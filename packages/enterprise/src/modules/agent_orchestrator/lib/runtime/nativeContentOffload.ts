import { createLogger } from '@open-mercato/shared/lib/logger'
import { mapWithConcurrency } from '@open-mercato/shared/lib/query/bounded-decrypt'
import {
  AGENT_TRACE_CONTENT_NAMESPACE,
  ARTIFACT_REFS,
  putArtifactResult,
  type ArtifactEncryptionRef,
  type ArtifactPutResult,
  type ArtifactScope,
} from '../trace/artifactStore'
import { buildLlmRequestArtifact, buildLlmResponseArtifact, type ContentRedaction } from '../trace/contentCapture'
import type {
  NativeModelCallContent,
  NativeModelCallContentOutcome,
  NativeModelCallRecord,
} from './nativeModelCallRecorder'

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

function prepareContent(
  content: NativeModelCallContent,
  label: string,
  options: ContentOffloadOptions,
): PreparedCall | null {
  try {
    const request = buildLlmRequestArtifact(content.request, { redactPii: options.redactPii })
    const response = buildLlmResponseArtifact(content.response, { redactPii: options.redactPii })
    return {
      request: { ref: ARTIFACT_REFS.llmRequest, payload: request.payload },
      response: { ref: ARTIFACT_REFS.llmResponse, payload: response.payload },
      truncated: request.truncated || response.truncated,
      redactions: mergeRedactions([request.redactions, response.redactions]),
    }
  } catch (error) {
    logger.warn('llm content artifact build failed', {
      callId: label,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function resolveOutcome(
  prepared: PreparedCall | null,
  request: ArtifactPutResult | null,
  response: ArtifactPutResult | null,
): NativeModelCallContentOutcome {
  const redactions = prepared?.redactions ?? []
  const requestKey = request?.status === 'stored' ? request.key : null
  const responseKey = response?.status === 'stored' ? response.key : null
  if (!prepared || !requestKey || !responseKey) {
    const encryptionUnavailable =
      request?.status === 'encryption_unavailable' || response?.status === 'encryption_unavailable'
    const status = encryptionUnavailable ? 'encryption_unavailable' : 'storage_unavailable'
    return { status, requestKey, responseKey, redactions }
  }
  return { status: prepared.truncated ? 'over_cap_truncated' : 'stored', requestKey, responseKey, redactions }
}

async function uploadTask(
  container: MinimalContainer,
  scope: ArtifactScope,
  task: UploadTask,
): Promise<ArtifactPutResult> {
  try {
    return await putArtifactResult(container, scope, task.ref, task.payload, AGENT_TRACE_CONTENT_NAMESPACE)
  } catch {
    return { status: 'storage_unavailable' }
  }
}

export type LlmContentEntry = { label: string; content: NativeModelCallContent } | null

/**
 * Builds the redacted, capped request/response artifacts of every entry,
 * uploads them to the trace content namespace with bounded concurrency and
 * returns one offload outcome per entry (`null` for a `null` entry). Never
 * throws: a failed build or upload yields `storage_unavailable`, and content
 * that could not be encrypted yields `encryption_unavailable`.
 */
export async function offloadLlmContentEntries(
  container: MinimalContainer,
  scope: ArtifactScope,
  entries: LlmContentEntry[],
  options: ContentOffloadOptions,
): Promise<Array<NativeModelCallContentOutcome | null>> {
  const prepared = entries.map((entry) => (entry ? prepareContent(entry.content, entry.label, options) : null))
  const tasks: UploadTask[] = []
  prepared.forEach((entry, callIndex) => {
    if (!entry) return
    tasks.push({ callIndex, part: 'request', ref: entry.request.ref, payload: entry.request.payload })
    tasks.push({ callIndex, part: 'response', ref: entry.response.ref, payload: entry.response.payload })
  })
  const results = await mapWithConcurrency(tasks, CONTENT_UPLOAD_CONCURRENCY, (task) =>
    uploadTask(container, scope, task),
  )
  const resultsByCall = new Map<number, { request: ArtifactPutResult | null; response: ArtifactPutResult | null }>()
  tasks.forEach((task, index) => {
    const entry = resultsByCall.get(task.callIndex) ?? { request: null, response: null }
    entry[task.part] = results[index]
    resultsByCall.set(task.callIndex, entry)
  })
  return entries.map((entry, callIndex) => {
    if (!entry) return null
    const callResults = resultsByCall.get(callIndex) ?? { request: null, response: null }
    return resolveOutcome(prepared[callIndex], callResults.request, callResults.response)
  })
}

/**
 * Offloads the content of every model call that retained it and returns the
 * calls without their content, each with the offload outcome. Never throws: a
 * failed upload yields `storage_unavailable` for that call.
 */
export async function offloadModelCallContent(
  container: MinimalContainer,
  scope: ArtifactScope,
  calls: NativeModelCallRecord[],
  options: ContentOffloadOptions,
): Promise<NativeModelCallRecord[]> {
  const outcomes = await offloadLlmContentEntries(
    container,
    scope,
    calls.map((call) => (call.content ? { label: call.callId, content: call.content } : null)),
    options,
  )
  return calls.map((call, callIndex) => {
    const outcome = outcomes[callIndex]
    if (!call.content || !outcome) return call
    return { ...withoutContent(call), contentOutcome: outcome }
  })
}
