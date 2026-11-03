import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { resolvePartitionEnvKey } from './partitionEnv'
import { resolveContainedPath, resolveLegacyPublicRoot } from './pathContainment'

export const STORAGE_ROOT_ENV_KEY = 'ATTACHMENTS_STORAGE_ROOT'

/**
 * Resolves the base directory that holds every partition directory. Deployment
 * configuration (`ATTACHMENTS_STORAGE_ROOT`) wins over the historical
 * `process.cwd()`-relative default, so the same attachment row resolves to the
 * same file regardless of the directory the process was started from. A
 * relative value is rejected rather than resolved against `process.cwd()`,
 * because `LocalStorageDriver.store()` creates missing directories and a typo
 * would otherwise silently produce a second, empty store.
 */
export function resolveStorageRoot(): string {
  const envPath = process.env[STORAGE_ROOT_ENV_KEY]
  if (envPath && envPath.trim().length > 0) {
    const trimmed = envPath.trim()
    if (!path.isAbsolute(trimmed)) {
      throw new Error(`[internal] ${STORAGE_ROOT_ENV_KEY} must be an absolute path, received: ${trimmed}`)
    }
    return path.resolve(trimmed)
  }
  return path.join(process.cwd(), 'storage', 'attachments')
}

export function resolvePartitionRoot(code: string): string {
  const envKey = resolvePartitionEnvKey(code)
  const envPath = process.env[envKey]
  if (envPath && envPath.trim().length > 0) {
    return path.resolve(envPath)
  }
  return path.join(resolveStorageRoot(), code)
}

function sanitizeFileName(fileName: string): string {
  if (!fileName) return 'file'
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function resolveOrgSegment(orgId: string | null | undefined): string {
  if (typeof orgId === 'string' && orgId.trim().length > 0) return `org_${orgId}`
  return 'org_shared'
}

function resolveTenantSegment(tenantId: string | null | undefined): string {
  if (typeof tenantId === 'string' && tenantId.trim().length > 0) return `tenant_${tenantId}`
  return 'tenant_shared'
}

/**
 * @deprecated Use `StorageDriverFactory.resolveForPartition()` + `driver.store()` instead.
 * Kept for backward compatibility with external callers.
 */
export type StorePartitionFilePayload = {
  partitionCode: string
  orgId: string | null | undefined
  tenantId: string | null | undefined
  fileName: string
  buffer: Buffer
}

export type StoredPartitionFile = {
  storagePath: string
  absolutePath: string
  fileName: string
}

/**
 * @deprecated Use `StorageDriverFactory.resolveForPartition()` + `driver.store()` instead.
 */
export async function storePartitionFile(payload: StorePartitionFilePayload): Promise<StoredPartitionFile> {
  const root = resolvePartitionRoot(payload.partitionCode)
  const orgSegment = resolveOrgSegment(payload.orgId ?? null)
  const tenantSegment = resolveTenantSegment(payload.tenantId ?? null)
  const safeName = sanitizeFileName(payload.fileName || 'file')
  const uniqueSuffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const storedName = `${Date.now()}_${uniqueSuffix}_${safeName}`
  const relativePath = path.join(orgSegment, tenantSegment, storedName)
  const absolutePath = path.join(root, relativePath)
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  await fs.writeFile(absolutePath, payload.buffer)
  return {
    storagePath: relativePath.replace(/\\/g, '/'),
    absolutePath,
    fileName: storedName,
  }
}

/**
 * @deprecated Use `StorageDriverFactory.resolveForAttachment()` + `driver.read()` / `driver.toLocalPath()` instead.
 */
export function resolveAttachmentAbsolutePath(
  partitionCode: string,
  storagePath: string,
  storageDriver?: string | null
): string {
  if (storageDriver === 'legacyPublic') {
    return resolveContainedPath(process.cwd(), storagePath, resolveLegacyPublicRoot())
  }
  const root = resolvePartitionRoot(partitionCode)
  return resolveContainedPath(root, storagePath)
}

/**
 * @deprecated Use `StorageDriverFactory.resolveForAttachment()` + `driver.delete()` instead.
 */
export async function deletePartitionFile(
  partitionCode: string,
  storagePath: string,
  storageDriver?: string | null
): Promise<void> {
  const absolutePath = resolveAttachmentAbsolutePath(partitionCode, storagePath, storageDriver)
  try {
    await fs.unlink(absolutePath)
  } catch {
    // best-effort removal
  }
}
