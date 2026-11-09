import type { AttachmentData, ErrorResponse } from 'resend'
import { createInboundResendClient } from './resendClient'

/**
 * Acquisition of Resend inbound attachment bytes for the ingest worker (spec
 * `2026-10-25-inbox-ops-inbound-attachments.md`, Ingest worker step 2). Every SDK call and every
 * download is bounded by the fetch timeout; the SDK answers `{ error }` instead of throwing.
 */

type SdkResult<T> = { data: T; error: null } | { data: null; error: ErrorResponse }

export type ResendInboundAttachmentDescriptor = Pick<AttachmentData, 'id' | 'download_url' | 'expires_at'>

/** The two `resend.emails.receiving.attachments` calls the worker uses. */
export type ResendInboundAttachmentsApi = {
  list(options: { emailId: string; after?: string; limit?: number }): Promise<SdkResult<{ has_more: boolean; data: ResendInboundAttachmentDescriptor[] }>>
  get(options: { emailId: string; id: string }): Promise<SdkResult<ResendInboundAttachmentDescriptor>>
}

export function createResendInboundAttachmentsApi(): ResendInboundAttachmentsApi {
  return createInboundResendClient().emails.receiving.attachments
}

export type ProviderCallFailure =
  | { kind: 'not_found' }
  | { kind: 'transient'; code: string }

const TIMEOUT_CODE = 'timeout'
const MAX_LIST_PAGES = 50
const LIST_PAGE_LIMIT = 100

class ProviderCallTimeoutError extends Error {
  constructor() {
    super('[internal] provider call timed out')
    this.name = 'ProviderCallTimeoutError'
  }
}

async function withTimeout<T>(call: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProviderCallTimeoutError()), timeoutMs)
  })
  try {
    return await Promise.race([call(), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * A 404 for the attachment or the email is permanent; 429, 5xx, 401/403 (an operator-fixable
 * key), network errors (`statusCode: null`) and anything else are transient until the 6-hour
 * finalization.
 */
export function classifyResendSdkError(error: Pick<ErrorResponse, 'statusCode' | 'name'> | null | undefined): ProviderCallFailure {
  const status = typeof error?.statusCode === 'number' ? error.statusCode : null
  if (status === 404) return { kind: 'not_found' }
  if (status !== null) return { kind: 'transient', code: `http_${status}` }
  if (error?.statusCode === null) return { kind: 'transient', code: 'network' }
  return error?.name === 'not_found' ? { kind: 'not_found' } : { kind: 'transient', code: 'unknown' }
}

async function callSdk<T>(call: () => Promise<SdkResult<T>>, timeoutMs: number): Promise<{ kind: 'ok'; data: T } | ProviderCallFailure> {
  try {
    const result = await withTimeout(call, timeoutMs)
    if (result.error || !result.data) return classifyResendSdkError(result.error)
    return { kind: 'ok', data: result.data }
  } catch (error) {
    return { kind: 'transient', code: error instanceof ProviderCallTimeoutError ? TIMEOUT_CODE : 'network' }
  }
}

export type ListedInboundAttachments = {
  /** Fresh descriptors by provider attachment id (possibly partial when a later page failed). */
  byId: Map<string, ResendInboundAttachmentDescriptor>
  /** The provider no longer has the email: every pending part is permanently unfetchable. */
  emailNotFound: boolean
  /** A list call failed; parts missing from `byId` take their URL from `get`. */
  failed: boolean
  /** `beforeNextPage` returned `false` (the caller lost its claim): listing stopped, nothing should be stored. */
  aborted: boolean
}

export type ListInboundAttachmentsOptions = {
  /** Provider attachment ids the caller still needs; paging stops once every one is listed. */
  wantedIds?: ReadonlySet<string>
  /**
   * Runs before each further page, e.g. to renew the caller's claim so up to {@link MAX_LIST_PAGES}
   * paged calls cannot outlast its lease; `false` stops listing with `aborted`.
   */
  beforeNextPage?: () => Promise<boolean>
}

/**
 * Lists fresh download URLs with `receiving.attachments.list`, paged with `after` until `has_more`
 * is false or every wanted id is listed.
 */
export async function listInboundAttachmentDescriptors(
  api: ResendInboundAttachmentsApi,
  providerEmailId: string,
  timeoutMs: number,
  options: ListInboundAttachmentsOptions = {},
): Promise<ListedInboundAttachments> {
  const byId = new Map<string, ResendInboundAttachmentDescriptor>()
  const wanted = options.wantedIds
  const listedEveryWanted = () => wanted !== undefined && [...wanted].every((id) => byId.has(id))
  let after: string | undefined
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    if (page > 0 && options.beforeNextPage && !await options.beforeNextPage()) {
      return { byId, emailNotFound: false, failed: false, aborted: true }
    }
    const cursor = after
    const result = await callSdk(
      () => api.list(cursor ? { emailId: providerEmailId, limit: LIST_PAGE_LIMIT, after: cursor } : { emailId: providerEmailId, limit: LIST_PAGE_LIMIT }),
      timeoutMs,
    )
    if (result.kind === 'not_found') return { byId, emailNotFound: page === 0, failed: true, aborted: false }
    if (result.kind === 'transient') return { byId, emailNotFound: false, failed: true, aborted: false }
    const items = Array.isArray(result.data.data) ? result.data.data : []
    for (const item of items) {
      if (item && typeof item.id === 'string') byId.set(item.id, item)
    }
    const last = items[items.length - 1]
    if (!result.data.has_more || !last || last.id === after || listedEveryWanted()) {
      return { byId, emailNotFound: false, failed: false, aborted: false }
    }
    after = last.id
  }
  return { byId, emailNotFound: false, failed: true, aborted: false }
}

export type DownloadResult =
  | { kind: 'ok'; buffer: Buffer }
  | { kind: 'too_large' }
  | { kind: 'http'; status: number }
  | { kind: 'transient'; code: string }

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

function isAllowedDownloadProtocol(protocol: string, allowHttp: boolean | undefined): boolean {
  return protocol === 'https:' || (allowHttp === true && protocol === 'http:')
}

/**
 * Streams a download URL with a size cap; the whole transfer is bounded by `timeoutMs`. Only
 * `https:` URLs are fetched; `allowHttp` (the test-only Resend stub, `resendStubEnabled`) also
 * admits `http:`. The rule holds for the final URL too: a redirect to another protocol is refused
 * like the URL itself, without reading the body.
 */
export async function downloadWithSizeCap(
  url: string,
  options: { timeoutMs: number; maxBytes: number; fetchImpl?: FetchLike; allowHttp?: boolean },
): Promise<DownloadResult> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { kind: 'transient', code: 'invalid_url' }
  }
  if (!isAllowedDownloadProtocol(parsed.protocol, options.allowHttp)) return { kind: 'transient', code: 'invalid_url' }

  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs)
  try {
    const response = await fetchImpl(parsed.toString(), { signal: controller.signal, redirect: 'follow' })
    // `fetch` follows redirects; `url` is the final one (empty only for a constructed Response).
    if (response.url && !isAllowedFinalUrl(response.url, options.allowHttp)) {
      await response.body?.cancel().catch(() => undefined)
      controller.abort()
      return { kind: 'transient', code: 'invalid_url' }
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return { kind: 'http', status: response.status }
    }
    const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10)
    if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
      controller.abort()
      return { kind: 'too_large' }
    }
    if (!response.body) return { kind: 'ok', buffer: Buffer.alloc(0) }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > options.maxBytes) {
        controller.abort()
        return { kind: 'too_large' }
      }
      chunks.push(value)
    }
    return { kind: 'ok', buffer: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))) }
  } catch {
    return { kind: 'transient', code: timedOut ? TIMEOUT_CODE : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

function isAllowedFinalUrl(url: string, allowHttp: boolean | undefined): boolean {
  try {
    return isAllowedDownloadProtocol(new URL(url).protocol, allowHttp)
  } catch {
    return false
  }
}

export type AcquirePartResult =
  | { kind: 'downloaded'; buffer: Buffer }
  | { kind: 'too_large' }
  | { kind: 'not_found' }
  | { kind: 'transient'; code: string }

export type AcquireInboundPartInput = {
  api: ResendInboundAttachmentsApi
  providerEmailId: string
  providerAttachmentId: string
  /** The descriptor from the list call, when the part was listed. */
  listed?: ResendInboundAttachmentDescriptor
  timeoutMs: number
  maxBytes: number
  fetchImpl?: FetchLike
  /** Admit `http:` download URLs: only while the test-only Resend stub is enabled. */
  allowHttp?: boolean
  now?: () => Date
}

function isUsable(descriptor: ResendInboundAttachmentDescriptor, now: Date, marginMs: number): boolean {
  if (typeof descriptor.download_url !== 'string' || descriptor.download_url.length === 0) return false
  const expiresAt = Date.parse(descriptor.expires_at)
  if (!Number.isFinite(expiresAt)) return false
  return expiresAt - marginMs > now.getTime()
}

function isExpiredUrlStatus(status: number): boolean {
  return status === 403 || status === 404
}

/**
 * Takes a usable URL (the listed one unless it is about to expire, else `receiving.attachments.get`),
 * downloads it, and on a 403/404 from the download URL itself refreshes it once through `get`.
 */
export async function acquireInboundPartBytes(input: AcquireInboundPartInput): Promise<AcquirePartResult> {
  const now = input.now ?? (() => new Date())
  const fetchFresh = () => callSdk(
    () => input.api.get({ emailId: input.providerEmailId, id: input.providerAttachmentId }),
    input.timeoutMs,
  )

  let descriptor: ResendInboundAttachmentDescriptor
  if (input.listed && isUsable(input.listed, now(), input.timeoutMs)) {
    descriptor = input.listed
  } else {
    const fresh = await fetchFresh()
    if (fresh.kind !== 'ok') return fresh
    descriptor = fresh.data
  }

  let refreshedAfterExpiredUrl = false

  for (;;) {
    const download = await downloadWithSizeCap(descriptor.download_url, {
      timeoutMs: input.timeoutMs,
      maxBytes: input.maxBytes,
      fetchImpl: input.fetchImpl,
      allowHttp: input.allowHttp,
    })
    if (download.kind === 'ok') return { kind: 'downloaded', buffer: download.buffer }
    if (download.kind === 'too_large') return download
    if (download.kind === 'transient') return download
    if (!isExpiredUrlStatus(download.status) || refreshedAfterExpiredUrl) {
      return { kind: 'transient', code: `download_http_${download.status}` }
    }
    const fresh = await fetchFresh()
    if (fresh.kind !== 'ok') return fresh
    descriptor = fresh.data
    refreshedAfterExpiredUrl = true
  }
}
