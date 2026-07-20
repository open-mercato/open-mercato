/**
 * Encrypted byte store for agent-produced file artifacts (file plane, #12).
 *
 * Sibling to `lib/trace/artifactStore.ts` (which offloads JSON trace payloads).
 * That store is JSON-payload-oriented; captured FILES are opaque bytes (a
 * generated PDF/CSV/XLSX, ≤ `OM_AGENT_ARTIFACT_MAX_BYTES`), so this store base64-
 * wraps the buffer and encrypts it at rest through the tenant DEK before uploading
 * to `storage-s3`, then reverses that on read. The `AgentRunArtifact` row keeps the
 * returned `storageKey`, sha256, mime, and size; the bytes never touch the DB.
 *
 * Fail-CLOSED by contract (unlike the trace store's fail-open): a capture is only
 * recorded when the encrypted bytes are durably stored. When `storage-s3` is
 * unconfigured for the tenant or any step throws, `putArtifactBytes` returns
 * `null` and the collector marks the file capture failed rather than recording a
 * row that points at bytes that were never stored.
 */

/** The `storage_s3` namespace all captured file artifacts are written under. */
export const AGENT_ARTIFACT_FILE_NAMESPACE = 'agent-run-artifacts'

/**
 * Encryption field reused to wrap the base64 blob. Points at the module's
 * declared `agent_run_artifact.caption` map (`encryption.ts`) so the DEK/algorithm
 * are the same the row's caption uses — no separate map is required.
 */
const ARTIFACT_BYTES_REF = { entityId: 'agent_orchestrator:agent_run_artifact', field: 'caption' } as const

export type ArtifactFileScope = { tenantId: string; organizationId: string }

type StorageTenantScope = {
  tenantId: string | null | undefined
  organizationId: string | null | undefined
}

// Structural types for the DI-resolved collaborators — the enterprise module
// stays decoupled from `@open-mercato/storage-s3` and only uses the subset it needs.
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

export type MinimalContainer = {
  resolve<T = unknown>(name: string): T
  hasRegistration?: (name: string) => boolean
}

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
  scope: ArtifactFileScope,
): Promise<StorageServiceLike | null> {
  const proxy = tryResolve<StorageProxyLike>(container, 'storageService')
  if (!proxy || typeof proxy._resolveService !== 'function') return null
  try {
    return await proxy._resolveService(scope)
  } catch {
    return null
  }
}

/** Wrap `{ caption: base64 }` and encrypt when encryption is available; else pass through. */
async function encryptWrapper(
  container: MinimalContainer,
  scope: ArtifactFileScope,
  base64: string,
): Promise<Record<string, unknown>> {
  const enc = tryResolve<TenantEncryptionLike>(container, 'tenantEncryptionService')
  const payload = { [ARTIFACT_BYTES_REF.field]: base64 }
  if (!enc || typeof enc.encryptEntityPayload !== 'function') return payload
  return enc.encryptEntityPayload(ARTIFACT_BYTES_REF.entityId, payload, scope.tenantId, scope.organizationId)
}

async function decryptWrapper(
  container: MinimalContainer,
  scope: ArtifactFileScope,
  wrapper: Record<string, unknown>,
): Promise<string | null> {
  const enc = tryResolve<TenantEncryptionLike>(container, 'tenantEncryptionService')
  if (!enc || typeof enc.decryptEntityPayload !== 'function') {
    const raw = wrapper[ARTIFACT_BYTES_REF.field]
    return typeof raw === 'string' ? raw : null
  }
  const decrypted = await enc.decryptEntityPayload(
    ARTIFACT_BYTES_REF.entityId,
    wrapper,
    scope.tenantId,
    scope.organizationId,
  )
  const raw = decrypted[ARTIFACT_BYTES_REF.field]
  return typeof raw === 'string' ? raw : null
}

/**
 * Upload one artifact's bytes encrypted at rest and return its storage key, or
 * `null` when storage is unavailable or the write fails (fail-closed). Never throws.
 */
export async function putArtifactBytes(
  container: MinimalContainer,
  scope: ArtifactFileScope,
  input: { buffer: Buffer; fileName: string; mimeType?: string },
): Promise<string | null> {
  try {
    const svc = await resolveStorageService(container, scope)
    if (!svc) return null
    const wrapper = await encryptWrapper(container, scope, input.buffer.toString('base64'))
    const { key } = await svc.upload({
      namespace: AGENT_ARTIFACT_FILE_NAMESPACE,
      fileName: `${input.fileName.replace(/[^a-zA-Z0-9_.-]+/g, '_')}.enc`,
      buffer: Buffer.from(JSON.stringify(wrapper), 'utf8'),
      contentType: 'application/octet-stream',
      scope,
    })
    return key || null
  } catch (error) {
    console.warn('[internal] agent_orchestrator: artifact byte upload failed', error)
    return null
  }
}

/**
 * Download + decrypt a previously stored artifact's bytes, or `null` when storage
 * is unavailable or the read/decrypt fails. Never throws.
 */
export async function getArtifactBytes(
  container: MinimalContainer,
  scope: ArtifactFileScope,
  storageKey: string,
): Promise<Buffer | null> {
  try {
    const svc = await resolveStorageService(container, scope)
    if (!svc) return null
    const { buffer } = await svc.download({ key: storageKey, scope })
    const wrapper = JSON.parse(buffer.toString('utf8')) as Record<string, unknown>
    const base64 = await decryptWrapper(container, scope, wrapper)
    if (base64 == null) return null
    return Buffer.from(base64, 'base64')
  } catch (error) {
    console.warn('[internal] agent_orchestrator: artifact byte fetch failed', error)
    return null
  }
}
