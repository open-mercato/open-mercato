import { promises as fs } from 'fs'
import path from 'path'
import type { StorageDriver, StoreFilePayload, StoredFile, ReadFileResult } from './types'

export class LegacyPublicStorageDriver implements StorageDriver {
  readonly key = 'legacyPublic'

  store(_payload: StoreFilePayload): Promise<StoredFile> {
    throw new Error('legacy-public driver is read-only')
  }

  async read(_partitionCode: string, storagePath: string): Promise<ReadFileResult> {
    const absolutePath = this.resolveAbsolutePath(storagePath)
    const buffer = await fs.readFile(absolutePath)
    return { buffer }
  }

  async delete(_partitionCode: string, storagePath: string): Promise<void> {
    const absolutePath = this.resolveAbsolutePath(storagePath)
    try {
      await fs.unlink(absolutePath)
    } catch {
      // best-effort removal
    }
  }

  async toLocalPath(
    _partitionCode: string,
    storagePath: string,
  ): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
    return {
      filePath: this.resolveAbsolutePath(storagePath),
      cleanup: async () => {},
    }
  }

  private resolveAbsolutePath(storagePath: string): string {
    let safeRelative = storagePath.replace(/^\/*/, '')
    let prev: string
    do {
      prev = safeRelative
      safeRelative = safeRelative.replace(/\.\.(\/|\\)/g, '')
    } while (safeRelative !== prev)
    return path.join(process.cwd(), safeRelative)
  }
}
