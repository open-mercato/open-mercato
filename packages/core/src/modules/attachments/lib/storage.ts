import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { resolvePartitionEnvKey } from './partitionEnv'

export function resolvePartitionRoot(code: string): string {
  const envKey = resolvePartitionEnvKey(code)
  const envPath = process.env[envKey]
  if (envPath && envPath.trim().length > 0) {
    return path.resolve(envPath)
  }
  return path.join(process.cwd(), 'storage', 'attachments', code)
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

export function resolveAttachmentAbsolutePath(
  partitionCode: string,
  storagePath: string,
  storageDriver?: string | null
): string {
  const safeRelative = storagePath.replace(/^\/*/, '').replace(/\.\.(\/|\\)/g, '')
  if (storageDriver === 'legacyPublic') {
    return path.join(process.cwd(), safeRelative)
  }
  const root = resolvePartitionRoot(partitionCode)
  return path.join(root, safeRelative)
}

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
