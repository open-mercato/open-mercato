/**
 * Framework-agnostic upload adapter for the AI chat composer.
 *
 * Forwards files dropped into {@link AiChat} to the existing attachments API
 * (`POST /api/attachments`, multipart form-data — see
 * `packages/core/src/modules/attachments/api/route.ts`) and returns the
 * resulting `attachmentIds` so the chat request layer can thread them into the
 * dispatcher body (`POST /api/ai_assistant/ai/chat?agent=<id>` reads
 * `attachmentIds` from JSON).
 *
 * The adapter is intentionally framework-agnostic: no Next.js imports, no
 * React. A thin React hook ({@link useAiChatUpload}) wraps it for the composer.
 */

const DEFAULT_ATTACHMENTS_ENDPOINT = '/api/attachments'
const DEFAULT_AI_CHAT_ENTITY_ID = 'ai-chat-draft'
const DEFAULT_CONCURRENCY = 3
// Hard cap on a single upload's wall-clock time. The previous implementation
// had no timeout, so a stalled `/api/attachments` request would leave the
// composer chip spinning forever (the server never returned, the client
// never unblocked the Send button). 60s is generous for the documented
// per-file size limits and matches the behaviour of the rest of the
// backoffice's `apiCall` helpers.
const DEFAULT_PER_FILE_TIMEOUT_MS = 60_000

export type UploadFailureReason =
  | 'mime_rejected'
  | 'size_exceeded'
  | 'network'
  | 'server'
  | 'aborted'

export interface UploadAttachmentsForChatOptions {
  /** Optional override for the attachments endpoint (defaults to `/api/attachments`). */
  endpoint?: string
  /** Entity identifier recorded alongside the attachment. Defaults to `'ai-chat-draft'`. */
  entityType?: string
  /**
   * Record identifier for the chat draft. When omitted, the adapter mints a
   * per-invocation UUID so every batch groups cleanly in the attachments table.
   */
  recordId?: string
  /** Optional partition code; forwarded verbatim to the attachments route. */
  partitionCode?: string
  /** Optional injectable fetch (tests, portal). Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch
  /** Optional progress callback fired once per file completion. */
  onProgress?: (
    fileIndex: number,
    progress: { loaded: number; total: number },
  ) => void
  /** Abort the whole batch; queued files short-circuit as `'aborted'`. */
  signal?: AbortSignal
  /** Parallelism cap. Defaults to 3. */
  concurrency?: number
  /**
   * Hard timeout per upload, in milliseconds. Defaults to 60_000 (60s).
   * When the upload exceeds the timeout the request is aborted and the
   * file lands in `failed` with `reason: 'aborted'` instead of the chip
   * spinning forever. Pass `0` to disable.
   */
  perFileTimeoutMs?: number
}

export interface UploadedAttachment {
  attachmentId: string
  /**
   * Server-returned (possibly sanitized) filename. The original
   * client-side `File.name` is preserved on `originalFileName` so the
   * chat composer can pair the upload result back to its chip without a
   * sanitization-induced map miss.
   */
  fileName: string
  /** The exact `File.name` the caller passed in. Always set. */
  originalFileName: string
  /** Position of this file in the original input array. Always set. */
  inputIndex: number
  mediaType: string
  size: number
}

export interface UploadFailure {
  fileName: string
  /** The exact `File.name` the caller passed in. Always set. */
  originalFileName: string
  /** Position of this file in the original input array. Always set. */
  inputIndex: number
  reason: UploadFailureReason
  message: string
}

export interface UploadAttachmentsForChatResult {
  items: UploadedAttachment[]
  failed: UploadFailure[]
}

function mintRecordId(): string {
  const cryptoApi = (globalThis as unknown as { crypto?: Crypto }).crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  const random = Math.random().toString(36).slice(2, 10)
  const time = Date.now().toString(36)
  return `ai-chat-${time}-${random}`
}

function resolveFetchImpl(explicit?: typeof fetch): typeof fetch {
  if (explicit) return explicit
  const fallback = (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch
  if (!fallback) {
    throw new Error('No fetch implementation available for uploadAttachmentsForChat')
  }
  return fallback.bind(globalThis) as typeof fetch
}

function normalizeServerErrorMessage(raw: unknown): string {
  if (raw && typeof raw === 'object') {
    const err = (raw as { error?: unknown; message?: unknown }).error
    if (typeof err === 'string' && err.trim()) return err
    const msg = (raw as { message?: unknown }).message
    if (typeof msg === 'string' && msg.trim()) return msg
  }
  return ''
}

function mapStatusToReason(status: number, message: string): UploadFailureReason {
  if (status === 413) return 'size_exceeded'
  if (status === 403 || status === 415) return 'mime_rejected'
  if (status === 400) {
    const lower = message.toLowerCase()
    if (lower.includes('file type') || lower.includes('active content')) {
      return 'mime_rejected'
    }
    if (lower.includes('size') || lower.includes('quota')) {
      return 'size_exceeded'
    }
  }
  return 'server'
}

function parseServerItem(
  payload: unknown,
  fallbackFile: File,
  inputIndex: number,
): UploadedAttachment | null {
  if (!payload || typeof payload !== 'object') return null
  const item = (payload as { item?: unknown }).item
  if (!item || typeof item !== 'object') return null
  const id = (item as { id?: unknown }).id
  if (typeof id !== 'string' || !id.trim()) return null
  const fileName =
    typeof (item as { fileName?: unknown }).fileName === 'string'
      ? (item as { fileName: string }).fileName
      : fallbackFile.name
  const fileSize = (item as { fileSize?: unknown }).fileSize
  const size =
    typeof fileSize === 'number' && Number.isFinite(fileSize) ? fileSize : fallbackFile.size
  const mimeTypeCandidate = (item as { mimeType?: unknown; mediaType?: unknown })
  const mediaType =
    typeof mimeTypeCandidate.mimeType === 'string' && mimeTypeCandidate.mimeType.trim()
      ? mimeTypeCandidate.mimeType
      : typeof mimeTypeCandidate.mediaType === 'string' && mimeTypeCandidate.mediaType.trim()
        ? mimeTypeCandidate.mediaType
        : fallbackFile.type || 'application/octet-stream'
  return {
    attachmentId: id,
    fileName,
    originalFileName: fallbackFile.name,
    inputIndex,
    mediaType,
    size,
  }
}

interface UploadSingleArgs {
  file: File
  fileIndex: number
  endpoint: string
  entityType: string
  recordId: string
  partitionCode?: string
  fetchImpl: typeof fetch
  signal: AbortSignal
  perFileTimeoutMs: number
  onProgress?: UploadAttachmentsForChatOptions['onProgress']
}

type SingleOutcome =
  | { ok: true; item: UploadedAttachment }
  | { ok: false; failure: UploadFailure }

async function uploadSingleFile(args: UploadSingleArgs): Promise<SingleOutcome> {
  const {
    file,
    fileIndex,
    endpoint,
    entityType,
    recordId,
    partitionCode,
    fetchImpl,
    signal,
    perFileTimeoutMs,
    onProgress,
  } = args

  const buildFailure = (
    reason: UploadFailureReason,
    message: string,
  ): UploadFailure => ({
    fileName: file.name,
    originalFileName: file.name,
    inputIndex: fileIndex,
    reason,
    message,
  })

  if (signal.aborted) {
    return {
      ok: false,
      failure: buildFailure('aborted', 'Upload aborted before starting.'),
    }
  }

  const form = new FormData()
  form.append('entityId', entityType)
  form.append('recordId', recordId)
  form.append('file', file)
  if (partitionCode && partitionCode.trim().length > 0) {
    form.append('partitionCode', partitionCode.trim())
  }

  // Per-file timeout — wired through a child AbortController that is also
  // cancelled when the parent batch aborts. Without this guard a stalled
  // server (slow OCR, dead connection) would leave the chip spinning
  // forever and block the composer's Send button indefinitely.
  const localController = new AbortController()
  const onParentAbort = () => localController.abort()
  signal.addEventListener('abort', onParentAbort, { once: true })
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  let timedOut = false
  if (perFileTimeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true
      localController.abort()
    }, perFileTimeoutMs)
  }
  const clearTimers = () => {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle)
      timeoutHandle = null
    }
    signal.removeEventListener('abort', onParentAbort)
  }

  let response: Response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      body: form,
      signal: localController.signal,
    })
  } catch (networkError) {
    clearTimers()
    if (timedOut) {
      return {
        ok: false,
        failure: buildFailure(
          'aborted',
          `Upload timed out after ${Math.round(perFileTimeoutMs / 1000)}s. The server did not respond — try again, or attach the file to a record first and reference it in the chat.`,
        ),
      }
    }
    const aborted =
      signal.aborted ||
      localController.signal.aborted ||
      (networkError as { name?: string } | undefined)?.name === 'AbortError'
    if (aborted) {
      return { ok: false, failure: buildFailure('aborted', 'Upload aborted.') }
    }
    const message =
      networkError instanceof Error ? networkError.message : 'Network request failed.'
    return { ok: false, failure: buildFailure('network', message) }
  }
  clearTimers()

  let payload: unknown = null
  try {
    const text = await response.text()
    if (text && text.trim()) {
      payload = JSON.parse(text) as unknown
    }
  } catch {
    // Response may not be JSON (HTML error page, empty body, etc.)
    payload = null
  }

  if (!response.ok) {
    const rawMessage = normalizeServerErrorMessage(payload)
    const fallbackMessage = rawMessage || `Upload failed (${response.status}).`
    const reason = mapStatusToReason(response.status, rawMessage)
    return { ok: false, failure: buildFailure(reason, fallbackMessage) }
  }

  const item = parseServerItem(payload, file, fileIndex)
  if (!item) {
    return {
      ok: false,
      failure: buildFailure(
        'server',
        'Attachment API returned an unexpected response shape.',
      ),
    }
  }

  if (onProgress) {
    try {
      onProgress(fileIndex, { loaded: item.size, total: item.size })
    } catch {
      // A misbehaving progress callback must never abort the upload pipeline.
    }
  }

  return { ok: true, item }
}

/**
 * Uploads files in parallel (bounded to `concurrency`, default 3) via the
 * attachments API and pairs the returned IDs back to the input order.
 *
 * The batch promise only rejects on programming errors — server rejections,
 * network errors, and aborts are surfaced via {@link UploadAttachmentsForChatResult.failed}
 * so the caller can render chips and retry UX without try/catch noise.
 */
export async function uploadAttachmentsForChat(
  files: File[],
  options: UploadAttachmentsForChatOptions = {},
): Promise<UploadAttachmentsForChatResult> {
  const items: UploadedAttachment[] = []
  const failed: UploadFailure[] = []
  if (!Array.isArray(files) || files.length === 0) {
    return { items, failed }
  }

  const fetchImpl = resolveFetchImpl(options.fetchImpl)
  const endpoint = options.endpoint?.trim() || DEFAULT_ATTACHMENTS_ENDPOINT
  const entityType = options.entityType?.trim() || DEFAULT_AI_CHAT_ENTITY_ID
  const recordId = options.recordId?.trim() || mintRecordId()
  const rawConcurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  const concurrency = Math.max(
    1,
    Math.min(files.length, Math.floor(rawConcurrency) || DEFAULT_CONCURRENCY),
  )
  const signal = options.signal ?? new AbortController().signal
  const perFileTimeoutMs = (() => {
    const raw = options.perFileTimeoutMs
    if (raw === 0) return 0
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
    return DEFAULT_PER_FILE_TIMEOUT_MS
  })()

  const outcomes: Array<SingleOutcome | null> = new Array(files.length).fill(null)
  let nextIndex = 0

  const worker = async (): Promise<void> => {
    while (true) {
      if (signal.aborted) return
      const currentIndex = nextIndex
      if (currentIndex >= files.length) return
      nextIndex = currentIndex + 1
      const file = files[currentIndex]
      outcomes[currentIndex] = await uploadSingleFile({
        file,
        fileIndex: currentIndex,
        endpoint,
        entityType,
        recordId,
        partitionCode: options.partitionCode,
        fetchImpl,
        signal,
        perFileTimeoutMs,
        onProgress: options.onProgress,
      })
    }
  }

  const workerCount = Math.min(concurrency, files.length)
  const workers = Array.from({ length: workerCount }, () => worker())
  await Promise.all(workers)

  for (let index = 0; index < files.length; index += 1) {
    const outcome = outcomes[index]
    if (outcome && outcome.ok) {
      items.push(outcome.item)
      continue
    }
    if (outcome && !outcome.ok) {
      failed.push(outcome.failure)
      continue
    }
    // Worker exited without processing this slot → it was skipped due to abort.
    const file = files[index]
    const fallbackName = file?.name ?? `file-${index}`
    failed.push({
      fileName: fallbackName,
      originalFileName: fallbackName,
      inputIndex: index,
      reason: 'aborted',
      message: 'Upload aborted before starting.',
    })
  }

  return { items, failed }
}

export const __testables = {
  DEFAULT_ATTACHMENTS_ENDPOINT,
  DEFAULT_AI_CHAT_ENTITY_ID,
  DEFAULT_CONCURRENCY,
  DEFAULT_PER_FILE_TIMEOUT_MS,
  mapStatusToReason,
}
