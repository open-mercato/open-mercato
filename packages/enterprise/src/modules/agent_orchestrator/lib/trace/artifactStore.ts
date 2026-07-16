/**
 * Encrypted artifact offload for trace ingestion (F1).
 *
 * Large trace payloads (a run's full output, a tool call's request/response)
 * are size-capped inline on their row today. This store offloads the *full*
 * payload to `storage-s3` — encrypted at rest via the tenant DEK — and returns
 * the storage key, so the row keeps only a redacted inline summary plus the key.
 *
 * Fail-open by contract: every entry point is best-effort. When storage is
 * unconfigured (dev/test, or no per-tenant `storage_s3` credentials) or any
 * step throws, the offload returns `null` and the caller keeps the inline
 * summary — trace ingestion must never fail because an artifact could not be
 * stored. The blob is encrypted through `TenantDataEncryptionService` under an
 * already-declared field map (`encryption.ts`); when encryption is disabled the
 * service no-ops and the blob is stored as plaintext JSON, exactly as the rest
 * of the module degrades.
 */

/** The `storage_s3` namespace all trace artifacts are written under. */
export const AGENT_TRACE_ARTIFACT_NAMESPACE = 'agent-trace-artifacts'

export type ArtifactScope = { tenantId: string; organizationId: string }

/**
 * Which declared encryption field the offloaded blob is encrypted under. Reuses
 * the module's existing `encryption.ts` maps so no new map is required: the blob
 * is wrapped as `{ [field]: <serialized> }` and encrypted like that entity field.
 */
export type ArtifactEncryptionRef = { entityId: string; field: string }

export const ARTIFACT_REFS = {
  runOutput: { entityId: 'agent_orchestrator:agent_run', field: 'output' },
  toolRequest: { entityId: 'agent_orchestrator:agent_tool_call', field: 'request_summary' },
  toolResponse: { entityId: 'agent_orchestrator:agent_tool_call', field: 'response_summary' },
} as const satisfies Record<string, ArtifactEncryptionRef>

type StorageTenantScope = {
  tenantId: string | null | undefined
  organizationId: string | null | undefined
}

// Structural types for the DI-resolved collaborators — the enterprise module
// stays decoupled from `@open-mercato/storage-s3` and only uses the subset of
// the storage/encryption contracts it needs.
type StorageServiceLike = {
  upload(input: {
    namespace: string
    fileName: string
    buffer: Buffer
    contentType?: string
    scope: StorageTenantScope
  }): Promise<{ key: string }>
  download(input: { key: string; scope: StorageTenantScope }): Promise<{ buffer: Buffer; contentType?: string }>
}

type StorageProxyLike = {
  _resolveService(scope: StorageTenantScope): Promise<StorageServiceLike>
}

type TenantEncryptionLike = {
  encryptEntityPayload(
    entityId: string,
    payload: Record<string, unknown>,
    tenantId: string | null | undefined,
    organizationId?: string | null,
  ): Promise<Record<string, unknown>>
  decryptEntityPayload(
    entityId: string,
    payload: Record<string, unknown>,
    tenantId: string | null | undefined,
    organizationId?: string | null,
  ): Promise<Record<string, unknown>>
}

type MinimalContainer = {
  resolve<T = unknown>(name: string): T
  hasRegistration?: (name: string) => boolean
}

/** An offload fn bound to a container + scope, injected into `ingestTrace`. */
export type ArtifactOffloader = (ref: ArtifactEncryptionRef, value: unknown) => Promise<string | null>

function tryResolve<T>(container: MinimalContainer, name: string): T | null {
  const hasRegistration =
    typeof container.hasRegistration === 'function' ? container.hasRegistration.bind(container) : null
  if (hasRegistration && !hasRegistration(name)) return null
  try {
    return container.resolve<T>(name)
  } catch {
    return null
  }
}

/**
 * Resolve a credentials-bound storage service for the scope, or `null` when the
 * `storage_s3` module is absent or the tenant has no configured credentials
 * (`_resolveService` throws in that case — treated as "storage unavailable").
 */
async function resolveStorageService(
  container: MinimalContainer,
  scope: ArtifactScope,
): Promise<StorageServiceLike | null> {
  const proxy = tryResolve<StorageProxyLike>(container, 'storageService')
  if (!proxy || typeof proxy._resolveService !== 'function') return null
  try {
    return await proxy._resolveService(scope)
  } catch {
    return null
  }
}

/** Encrypt `{ [field]: serialized }` when encryption is available; else pass through. */
async function encryptWrapper(
  container: MinimalContainer,
  scope: ArtifactScope,
  ref: ArtifactEncryptionRef,
  serialized: string,
): Promise<Record<string, unknown>> {
  const enc = tryResolve<TenantEncryptionLike>(container, 'tenantEncryptionService')
  const payload = { [ref.field]: serialized }
  if (!enc || typeof enc.encryptEntityPayload !== 'function') return payload
  return enc.encryptEntityPayload(ref.entityId, payload, scope.tenantId, scope.organizationId)
}

/**
 * Offload one full payload to encrypted storage and return its key, or `null`
 * when storage is unavailable or the write fails. Never throws.
 */
export async function putArtifact(
  container: MinimalContainer,
  scope: ArtifactScope,
  ref: ArtifactEncryptionRef,
  value: unknown,
): Promise<string | null> {
  try {
    const svc = await resolveStorageService(container, scope)
    if (!svc) return null
    const serialized = JSON.stringify(value ?? null)
    const wrapper = await encryptWrapper(container, scope, ref, serialized)
    const { key } = await svc.upload({
      namespace: AGENT_TRACE_ARTIFACT_NAMESPACE,
      fileName: `${ref.entityId.replace(/[^a-zA-Z0-9_-]+/g, '_')}-${ref.field}.json`,
      buffer: Buffer.from(JSON.stringify(wrapper), 'utf8'),
      contentType: 'application/json',
      scope,
    })
    return key || null
  } catch (error) {
    console.warn('[internal] agent_orchestrator: artifact offload failed; keeping inline summary', error)
    return null
  }
}

/**
 * Download + decrypt a previously offloaded artifact, returning the original
 * value, or `null` when storage is unavailable or the read fails. Never throws.
 */
export async function getArtifact(
  container: MinimalContainer,
  scope: ArtifactScope,
  ref: ArtifactEncryptionRef,
  key: string,
): Promise<unknown | null> {
  try {
    const svc = await resolveStorageService(container, scope)
    if (!svc) return null
    const { buffer } = await svc.download({ key, scope })
    const wrapper = JSON.parse(buffer.toString('utf8')) as Record<string, unknown>
    const enc = tryResolve<TenantEncryptionLike>(container, 'tenantEncryptionService')
    let serialized: unknown = wrapper[ref.field]
    if (enc && typeof enc.decryptEntityPayload === 'function') {
      const decrypted = await enc.decryptEntityPayload(ref.entityId, wrapper, scope.tenantId, scope.organizationId)
      serialized = decrypted[ref.field]
    }
    if (typeof serialized !== 'string') return serialized ?? null
    try {
      return JSON.parse(serialized)
    } catch {
      return serialized
    }
  } catch (error) {
    console.warn('[internal] agent_orchestrator: artifact fetch failed', error)
    return null
  }
}

/** Build an offloader bound to a container + scope for `ingestTrace`. */
export function createArtifactOffloader(container: MinimalContainer, scope: ArtifactScope): ArtifactOffloader {
  return (ref, value) => putArtifact(container, scope, ref, value)
}
