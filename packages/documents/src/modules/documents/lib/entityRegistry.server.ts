import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  fetchWithTimeout,
  type FetchWithTimeoutInit,
  resolveTimeoutMs,
  withTimeout,
} from '@open-mercato/shared/lib/http/fetchWithTimeout'
import { getSecurityEmailBaseUrl } from '@open-mercato/shared/lib/url'
import type { DocumentEntityType } from '../data/validators'
import {
  getEntityRegistryEntry,
  readItemsArray,
  type EntityPickerItem,
} from './entityRegistry'
import { isDocumentEntityRegistryModuleEnabled } from './entityRegistryAvailability.server'

export type VerifyEntityRegistrySelectionInput = {
  entityType: DocumentEntityType
  entityId: string
  label: string
  href: string
}

export type VerifyEntityRegistryTargetAccessInput = Pick<
  VerifyEntityRegistrySelectionInput,
  'entityType' | 'entityId'
>

export type VerifiedEntityRegistrySelection = EntityPickerItem & {
  href: string
  values: Record<string, string | null>
}

type RegistryFetch = (
  input: RequestInfo | URL,
  init?: FetchWithTimeoutInit,
) => Promise<Response>

const DEFAULT_REGISTRY_LOOKUP_TIMEOUT_MS = 3_000
const MAX_REGISTRY_RESPONSE_BYTES = 1_000_000

async function readRegistryJsonBody(
  response: Response,
  callerSignal: AbortSignal,
  timeoutMs: number,
): Promise<unknown> {
  return withTimeout(async (timeoutSignal) => {
    const signals = [callerSignal, timeoutSignal]
    for (const signal of signals) {
      if (signal.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Aborted', 'AbortError')
      }
    }

    const reader = response.body?.getReader()
    if (!reader) return null
    let aborted: unknown = null
    const listeners = signals.map((signal) => {
      let handled = false
      const listener = () => {
        if (handled) return
        handled = true
        aborted = signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Aborted', 'AbortError')
        void reader.cancel(aborted).catch(() => undefined)
      }
      signal.addEventListener('abort', listener, { once: true })
      if (signal.aborted) listener()
      return { signal, listener }
    })

    const decoder = new TextDecoder()
    let decoded = ''
    let totalBytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        totalBytes += value.byteLength
        if (totalBytes > MAX_REGISTRY_RESPONSE_BYTES) {
          await reader.cancel().catch(() => undefined)
          throw new Error('[internal] Entity registry response exceeded the size limit')
        }
        decoded += decoder.decode(value, { stream: true })
      }
      if (aborted) throw aborted
      decoded += decoder.decode()
    } finally {
      for (const { signal, listener } of listeners) {
        signal.removeEventListener('abort', listener)
      }
      reader.releaseLock()
    }

    try {
      return JSON.parse(decoded) as unknown
    } catch {
      return null
    }
  }, timeoutMs, 'documents entity-registry response')
}

function buildForwardedHeaders(request: Request): Headers {
  const headers = new Headers()
  const cookie = request.headers.get('cookie')
  const authorization = request.headers.get('authorization')
  const apiKey = request.headers.get('x-api-key')
  if (cookie) headers.set('cookie', cookie)
  if (authorization) headers.set('authorization', authorization)
  if (apiKey) headers.set('x-api-key', apiKey)
  return headers
}

type RegistryVerificationOptions = {
  fetchImpl?: RegistryFetch
  timeoutMs?: number
  maskTargetAbsence?: boolean
}

async function verifyEntityRegistryTarget(
  request: Request,
  input: VerifyEntityRegistryTargetAccessInput,
  options: RegistryVerificationOptions = {},
): Promise<VerifiedEntityRegistrySelection> {
  const entry = getEntityRegistryEntry(input.entityType)
  if (!entry) {
    throw new CrudHttpError(400, { error: 'documents.links.invalidEntityType' })
  }
  if (!isDocumentEntityRegistryModuleEnabled(entry)) {
    throw new CrudHttpError(503, { error: 'documents.links.targetUnavailable' })
  }

  const timeoutMs = Math.min(
    resolveTimeoutMs(options.timeoutMs, DEFAULT_REGISTRY_LOOKUP_TIMEOUT_MS),
    DEFAULT_REGISTRY_LOOKUP_TIMEOUT_MS,
  )
  const deadline = Date.now() + timeoutMs
  let response: Response
  try {
    // This request carries the caller's credentials, so its destination must
    // come from the configured application URL rather than request.url/Host.
    // getSecurityEmailBaseUrl intentionally has a fixed loopback development
    // fallback and requires APP_URL in production.
    const lookupUrl = new URL(entry.searchPath, getSecurityEmailBaseUrl())
    lookupUrl.searchParams.set('id', input.entityId)
    lookupUrl.searchParams.set('pageSize', '1')
    const fetchImpl = options.fetchImpl ?? fetchWithTimeout
    response = await fetchImpl(lookupUrl, {
      method: 'GET',
      headers: buildForwardedHeaders(request),
      cache: 'no-store',
      redirect: 'manual',
      signal: request.signal,
      timeoutMs,
    })
  } catch {
    throw new CrudHttpError(503, { error: 'documents.links.targetUnavailable' })
  }

  if (response.status === 404) {
    throw new CrudHttpError(options.maskTargetAbsence ? 403 : 503, {
      error: options.maskTargetAbsence
        ? 'documents.links.targetRestricted'
        : 'documents.links.targetUnavailable',
    })
  }
  if (response.status >= 500) {
    throw new CrudHttpError(503, { error: 'documents.links.targetUnavailable' })
  }
  if (!response.ok) {
    throw new CrudHttpError(response.status === 401 ? 401 : 403, {
      error: 'documents.links.targetRestricted',
    })
  }

  let payload: unknown
  try {
    payload = await readRegistryJsonBody(
      response,
      request.signal,
      Math.max(1, deadline - Date.now()),
    )
  } catch {
    throw new CrudHttpError(503, { error: 'documents.links.targetUnavailable' })
  }
  const rawItem = readItemsArray(payload).find((candidate) => (
    entry.mapItem(candidate)?.id === input.entityId
  )) ?? null
  const mapped = rawItem ? entry.mapItem(rawItem) : null
  const resolvedHref = mapped ? entry.resolveHref(mapped) : null
  if (!mapped || !rawItem || !resolvedHref || !entry.isCanonicalHref(mapped, resolvedHref)) {
    throw new CrudHttpError(options.maskTargetAbsence ? 403 : 400, {
      error: options.maskTargetAbsence
        ? 'documents.links.targetRestricted'
        : 'documents.links.targetMismatch',
    })
  }
  return {
    ...mapped,
    href: resolvedHref,
    values: Object.fromEntries(entry.tokenFields.map((field) => [field.field, field.extract(rawItem)])),
  }
}

export async function verifyEntityRegistrySelection(
  request: Request,
  input: VerifyEntityRegistrySelectionInput,
  options: { fetchImpl?: RegistryFetch; timeoutMs?: number } = {},
): Promise<VerifiedEntityRegistrySelection> {
  return verifyEntityRegistryTarget(request, input, options)
}

/**
 * Verify access to one exact peer record before using its UUID as a reverse
 * relation filter. Missing and restricted targets intentionally share the same
 * denial so the Documents collection cannot become a peer-record oracle.
 */
export async function verifyEntityRegistryTargetAccess(
  request: Request,
  input: VerifyEntityRegistryTargetAccessInput,
  options: { fetchImpl?: RegistryFetch; timeoutMs?: number } = {},
): Promise<VerifiedEntityRegistrySelection> {
  try {
    return await verifyEntityRegistryTarget(request, input, {
      ...options,
      maskTargetAbsence: true,
    })
  } catch (error) {
    if (isCrudHttpError(error) && error.status >= 400 && error.status < 500) {
      throw new CrudHttpError(403, { error: 'documents.links.targetRestricted' })
    }
    throw error
  }
}

export async function verifyEntityRegistrySelections(
  request: Request,
  inputs: VerifyEntityRegistrySelectionInput[],
  options: { fetchImpl?: RegistryFetch; concurrency?: number; timeoutMs?: number } = {},
): Promise<Map<string, VerifiedEntityRegistrySelection>> {
  const deduped = Array.from(
    new Map(inputs.map((input) => [`${input.entityType}:${input.entityId}`, input])).values(),
  )
  if (deduped.length > 20) {
    throw new CrudHttpError(400, { error: 'documents.templates.tooManySlots' })
  }

  const concurrency = Math.max(1, Math.min(4, options.concurrency ?? 4))
  const verified = new Map<string, VerifiedEntityRegistrySelection>()
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, deduped.length) }, async () => {
    while (nextIndex < deduped.length) {
      const index = nextIndex
      nextIndex += 1
      const input = deduped[index]!
      verified.set(
        `${input.entityType}:${input.entityId}`,
        await verifyEntityRegistrySelection(request, input, options),
      )
    }
  })
  await Promise.all(workers)
  return verified
}
