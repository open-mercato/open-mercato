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
 * unconfigured for the tenant or any step throws, `putArtifactBytesResult`
 * reports `storage_unavailable` and the collector counts the file as not stored
 * rather than recording a row that points at bytes that were never stored. The
 * same holds, reported as `encryption_unavailable`, when encryption is on but
 * the bytes cannot be encrypted (service absent, KMS unhealthy, no DEK).
 * With tenant data encryption turned off the bytes are stored unencrypted, like
 * every other encrypted column in that mode. Reads accept both forms.
 */

import { createLogger } from '@open-mercato/shared/lib/logger'
import { sealArtifactPayload } from '../trace/sealArtifactPayload'

const logger = createLogger('agent_orchestrator').child({ component: 'artifact-file-store' })

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

export type ArtifactBytesFailureReason = 'encryption_unavailable' | 'storage_unavailable'

export type ArtifactBytesPutResult =
  | { status: 'stored'; key: string }
  | { status: ArtifactBytesFailureReason }

/**
 * Upload one artifact's bytes encrypted at rest and report the outcome:
 * `stored` with its key, `encryption_unavailable` when tenant data encryption is
 * on but the bytes could not be sealed (nothing is uploaded), or
 * `storage_unavailable` when storage is unconfigured or the write fails
 * (fail-closed). Never throws and never logs the file name.
 */
export async function putArtifactBytesResult(
  container: MinimalContainer,
  scope: ArtifactFileScope,
  input: { buffer: Buffer; fileName: string; mimeType?: string },
): Promise<ArtifactBytesPutResult> {
  const svc = await resolveStorageService(container, scope)
  if (!svc) return { status: 'storage_unavailable' }
  let wrapper: Record<string, unknown> | null
  try {
    const enc = tryResolve<TenantEncryptionLike>(container, 'tenantEncryptionService')
    wrapper = await sealArtifactPayload(enc, scope, ARTIFACT_BYTES_REF, input.buffer.toString('base64'))
  } catch (error) {
    logger.warn('artifact byte encryption failed', {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    wrapper = null
  }
  if (!wrapper) return { status: 'encryption_unavailable' }
  try {
    const { key } = await svc.upload({
      namespace: AGENT_ARTIFACT_FILE_NAMESPACE,
      fileName: `${input.fileName.replace(/[^a-zA-Z0-9_.-]+/g, '_')}.enc`,
      buffer: Buffer.from(JSON.stringify(wrapper), 'utf8'),
      contentType: 'application/octet-stream',
      scope,
    })
    return key ? { status: 'stored', key } : { status: 'storage_unavailable' }
  } catch (error) {
    logger.warn('artifact byte upload failed', {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { status: 'storage_unavailable' }
  }
}

/**
 * Upload one artifact's bytes encrypted at rest and return its storage key, or
 * `null` when storage is unavailable, the bytes cannot be encrypted, or the write
 * fails (fail-closed). Never throws.
 */
export async function putArtifactBytes(
  container: MinimalContainer,
  scope: ArtifactFileScope,
  input: { buffer: Buffer; fileName: string; mimeType?: string },
): Promise<string | null> {
  const result = await putArtifactBytesResult(container, scope, input)
  return result.status === 'stored' ? result.key : null
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
    logger.warn('artifact byte fetch failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
