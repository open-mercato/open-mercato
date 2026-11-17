import { createHash } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { wrapLanguageModel, createDownload, type LanguageModel, type Experimental_DownloadFunction } from 'ai'
import { z } from 'zod'
import { withModelFactoryOverride } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory-context'
import type { AiModelResolution } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import { canonicalJsonStringify } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-definition-hash'

type Model = ReturnType<typeof wrapLanguageModel>
type CallOptions = Parameters<Model['doGenerate']>[0]
type GenerateResult = Awaited<ReturnType<Model['doGenerate']>>
type StreamPart = Awaited<ReturnType<Model['doStream']>>['stream'] extends ReadableStream<infer Part> ? Part : never

export const modelRecordingSchema = z.object({
  inputKey: z.string().length(64),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  source: z.string(),
  sdkProvider: z.string(),
  providerOptions: z.record(z.string(), z.unknown()).optional(),
  downloads: z.array(z.object({
    urls: z.array(z.string()).max(1000),
    files: z.array(z.object({ data: z.string(), mediaType: z.string().optional() }).nullable()).max(1000),
  })).max(1000).default([]),
  calls: z.array(z.object({
    kind: z.enum(['generate', 'stream']),
    requestKey: z.string().length(64),
    result: z.unknown(),
  })).max(1000),
})
export type ModelRecording = z.infer<typeof modelRecordingSchema>

const offlineKey = Symbol.for('@open-mercato/agent-orchestrator/offline-model-replay')
const globalScope = globalThis as typeof globalThis & { [offlineKey]?: AsyncLocalStorage<boolean> }
const offlineStorage = globalScope[offlineKey] ??= new AsyncLocalStorage<boolean>()
export function isOfflineModelReplay(): boolean {
  return offlineStorage.getStore() === true
}

function encode(value: unknown): unknown {
  if (value instanceof Uint8Array) return { __omBytes: Buffer.from(value).toString('base64') }
  if (value instanceof Date) return { __omDate: value.toISOString() }
  if (value instanceof URL) return { __omUrl: value.href }
  if (Array.isArray(value)) return value.map(encode)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).map(([key, entry]) => [key, encode(entry)]))
  }
  return value
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.__omBytes === 'string') return new Uint8Array(Buffer.from(record.__omBytes, 'base64'))
    if (typeof record.__omDate === 'string') return new Date(record.__omDate)
    if (typeof record.__omUrl === 'string') return new URL(record.__omUrl)
    return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, decode(entry)]))
  }
  return value
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJsonStringify(encode(value))).digest('hex')
}

function requestKey(options: CallOptions): string {
  const { abortSignal, headers, ...request } = options
  void abortSignal
  void headers
  return fingerprint(request)
}

export class ModelReplayError extends Error {
  constructor(readonly code: string) {
    super(`[internal] ${code}`)
    this.name = 'ModelReplayError'
  }
}

export function createModelReplaySession(mode: 'record' | 'replay', recordings: ModelRecording[] = []) {
  const recorded: ModelRecording[] = []
  let resolutionIndex = 0
  let failure: ModelReplayError | null = null
  const consumed: Array<{ recording: ModelRecording; count: () => number; downloaded: () => number }> = []
  const fail = (code: string): never => {
    failure = new ModelReplayError(code)
    throw failure
  }
  return {
    recorded,
    assertComplete() {
      if (failure) throw failure
      if (mode === 'record' && recorded.some((entry) => entry.calls.some((call) => call.result === undefined))) fail('model_record_incomplete')
      if (mode === 'replay' && (resolutionIndex !== recordings.length || consumed.some((entry) => entry.count() !== entry.recording.calls.length || entry.downloaded() !== entry.recording.downloads.length))) {
        fail('model_fixture_unused')
      }
    },
    run<T>(run: () => Promise<T>): Promise<T> {
      return offlineStorage.run(mode === 'replay', () => withModelFactoryOverride((input, resolveLive) => {
        const inputKey = fingerprint(input)
        const live = mode === 'record' ? resolveLive() : null
        const base = live ? wrapLanguageModel({ model: live.model as Exclude<LanguageModel, string>, middleware: {} }) : null
        const recording: ModelRecording = live
          ? { inputKey, providerId: live.providerId, modelId: live.modelId, source: live.source, sdkProvider: base!.provider, providerOptions: live.providerOptions, downloads: [], calls: [] }
          : recordings[resolutionIndex++] ?? fail('model_fixture_missing')
        if (recording.inputKey !== inputKey) fail('model_fixture_input_mismatch')
        if (live) recorded.push(recording)
        let callIndex = 0
        let downloadIndex = 0
        consumed.push({ recording, count: () => callIndex, downloaded: () => downloadIndex })
        const download: Experimental_DownloadFunction = async (requests) => {
          if (!requests.length) return []
          const urls = requests.map((request) => request.url.href)
          if (!live) {
            const batch = recording.downloads[downloadIndex++] ?? fail('model_fixture_download_missing')
            if (fingerprint(urls) !== fingerprint(batch.urls) || batch.files.length !== requests.length) fail('model_fixture_download_mismatch')
            return batch.files.map((file) => file ? { data: new Uint8Array(Buffer.from(file.data, 'base64')), mediaType: file.mediaType } : null)
          }
          try {
            const files = await Promise.all(requests.map((request) => request.isUrlSupportedByModel ? null : createDownload({ maxBytes: 5 * 1024 * 1024 })({ url: request.url })))
            recording.downloads.push({ urls, files: files.map((file) => file ? { data: Buffer.from(file.data).toString('base64'), ...(file.mediaType ? { mediaType: file.mediaType } : {}) } : null) })
            return files
          } catch {
            return fail('model_record_download_failed')
          }
        }
        const take = (kind: 'generate' | 'stream', options: CallOptions): unknown => {
          const call = recording.calls[callIndex++] ?? fail('model_fixture_missing')
          if (call.kind !== kind || call.requestKey !== requestKey(options)) fail('model_fixture_request_mismatch')
          const result = decode(call.result)
          if (kind === 'generate') {
            if (!result || typeof result !== 'object' || !('content' in result) || !Array.isArray(result.content) || !('finishReason' in result) || !('usage' in result)) fail('model_fixture_result_invalid')
          } else if (!result || typeof result !== 'object' || !('parts' in result) || !Array.isArray(result.parts) || !result.parts.some((part: unknown) => part && typeof part === 'object' && 'type' in part && part.type === 'finish')) {
            fail('model_fixture_result_invalid')
          }
          return result
        }
        const model: Model = {
          specificationVersion: 'v4',
          provider: recording.sdkProvider,
          modelId: recording.modelId,
          supportedUrls: base?.supportedUrls ?? { '*/*': [/.*/] },
          async doGenerate(options) {
            if (!base) return take('generate', options) as GenerateResult
            const call = { kind: 'generate' as const, requestKey: requestKey(options), result: undefined as unknown }
            recording.calls.push(call)
            const result = await base.doGenerate(options)
            call.result = encode(result)
            return result
          },
          async doStream(options) {
            if (!base) {
              const result = take('stream', options) as { parts: StreamPart[]; metadata: Omit<Awaited<ReturnType<Model['doStream']>>, 'stream'> }
              return { ...result.metadata, stream: new ReadableStream<StreamPart>({ start(controller) {
                for (const part of result.parts) controller.enqueue(part)
                controller.close()
              } }) }
            }
            const parts: StreamPart[] = []
            const call = { kind: 'stream' as const, requestKey: requestKey(options), result: undefined as unknown }
            recording.calls.push(call)
            const result = await base.doStream(options)
            const { stream, ...metadata } = result
            return { ...result, stream: stream.pipeThrough(new TransformStream<StreamPart, StreamPart>({
              transform(part, controller) { parts.push(part); controller.enqueue(part) },
              flush() { call.result = parts.some((part) => part.type === 'error') ? undefined : encode({ parts, metadata }) },
            })) }
          },
        }
        return { ...(live ?? {}), model, download, modelId: recording.modelId, providerId: recording.providerId,
          ...(recording.providerOptions ? { providerOptions: recording.providerOptions as AiModelResolution['providerOptions'] } : {}),
          source: recording.source as AiModelResolution['source'], supportsInputModeration: live?.supportsInputModeration ?? false }
      }, run, { isolateTools: mode === 'record' }))
    },
  }
}
