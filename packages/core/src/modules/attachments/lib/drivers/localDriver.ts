import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { resolvePartitionRoot } from '../storage'
import { resolveContainedPath } from '../pathContainment'
import type { PrepareFilePayload, StorageDriver, StoreFilePayload, StoredFile, ReadFileResult } from './types'

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

  prepareStoragePath(payload: PrepareFilePayload): string {
    const orgSegment = resolveOrgSegment(payload.orgId ?? null)
    const tenantSegment = resolveTenantSegment(payload.tenantId ?? null)
    const safeName = sanitizeFileName(payload.fileName || 'file')
    const uniqueSuffix = randomUUID().replace(/-/g, '').slice(0, 12)
    const storedName = `${Date.now()}_${uniqueSuffix}_${safeName}`
    return path.join(orgSegment, tenantSegment, storedName).replace(/\\/g, '/')
  }

  async store(payload: StoreFilePayload): Promise<StoredFile> {
    const root = resolvePartitionRoot(payload.partitionCode)
    const relativePath = payload.storagePath ?? this.prepareStoragePath(payload)
    const absolutePath = path.join(root, relativePath)
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, payload.buffer, { flag: 'wx' })
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
    try {
      await this.deleteStrict(partitionCode, storagePath)
    } catch {
      // Backward-compatible best-effort removal.
    }
  }

  async deleteStrict(partitionCode: string, storagePath: string): Promise<void> {
    const absolutePath = this.resolveAbsolutePath(partitionCode, storagePath)
    try {
      if (typeof fs.rm === 'function') await fs.rm(absolutePath, { force: true })
      else await fs.unlink(absolutePath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      const message = error instanceof Error ? error.message : ''
      if (code !== 'ENOENT' && !message.includes('ENOENT')) throw error
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
    const root = resolvePartitionRoot(partitionCode)
    return resolveContainedPath(root, storagePath)
  }
}
