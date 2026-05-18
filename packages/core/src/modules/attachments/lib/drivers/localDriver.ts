import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { resolvePartitionRoot } from '../storage'
import type { StorageDriver, StoreFilePayload, StoredFile, ReadFileResult } from './types'

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

export class LocalStorageDriver implements StorageDriver {
  readonly key = 'local'

  async store(payload: StoreFilePayload): Promise<StoredFile> {
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
    }
  }

  async read(partitionCode: string, storagePath: string): Promise<ReadFileResult> {
    const absolutePath = this.resolveAbsolutePath(partitionCode, storagePath)
    const buffer = await fs.readFile(absolutePath)
    return { buffer }
  }

  async delete(partitionCode: string, storagePath: string): Promise<void> {
    const absolutePath = this.resolveAbsolutePath(partitionCode, storagePath)
    try {
      await fs.unlink(absolutePath)
    } catch {
      // best-effort removal
    }
  }

  async toLocalPath(
    partitionCode: string,
    storagePath: string,
  ): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
    const filePath = this.resolveAbsolutePath(partitionCode, storagePath)
    return {
      filePath,
      cleanup: async () => {
        // no-op: local path is the real file, do not delete
      },
    }
  }

  private resolveAbsolutePath(partitionCode: string, storagePath: string): string {
    let safeRelative = storagePath.replace(/^\/*/, '')
    let prev: string
    do {
      prev = safeRelative
      safeRelative = safeRelative.replace(/\.\.(\/|\\)/g, '')
    } while (safeRelative !== prev)
    const root = resolvePartitionRoot(partitionCode)
    return path.join(root, safeRelative)
  }
}
