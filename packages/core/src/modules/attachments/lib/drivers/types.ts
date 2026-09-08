export type StoreFilePayload = {
  partitionCode: string
  orgId: string | null | undefined
  tenantId: string | null | undefined
  fileName: string
  buffer: Buffer
  storagePath?: string
}

export type PrepareFilePayload = Omit<StoreFilePayload, 'buffer' | 'storagePath'>

export type StoredFile = {
  storagePath: string
  driverMeta?: Record<string, unknown> | null
}

export type ReadFileResult = {
  buffer: Buffer
  contentType?: string
}

export interface StorageDriver {
  readonly key: string
  prepareStoragePath?(payload: PrepareFilePayload): string
  store(payload: StoreFilePayload): Promise<StoredFile>
  read(partitionCode: string, storagePath: string): Promise<ReadFileResult>
  delete(partitionCode: string, storagePath: string): Promise<void>
  deleteStrict?(partitionCode: string, storagePath: string): Promise<void>
  toLocalPath(
    partitionCode: string,
    storagePath: string,
  ): Promise<{ filePath: string; cleanup: () => Promise<void> }>
}
