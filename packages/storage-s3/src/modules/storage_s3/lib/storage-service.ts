import { randomUUID } from 'crypto'
import { S3StorageDriver } from './s3-driver'

type TenantScope = {
  tenantId: string | null | undefined
  organizationId: string | null | undefined
}

type UploadInput = {
  namespace: string
  fileName: string
  buffer: Buffer
  contentType?: string
  scope: TenantScope
}

type StorageResult = {
  key: string
  namespace: string
  fileName: string
  size: number
  contentType?: string
}

type DownloadInput = { key: string; scope: TenantScope }
type DeleteInput = { key: string; scope: TenantScope }
type SignedUrlInput = {
  key: string
  operation: 'upload' | 'download'
  expiresIn?: number
  contentType?: string
  scope: TenantScope
}
type ListInput = {
  prefix: string
  maxKeys?: number
  continuationToken?: string
  scope: TenantScope
}

type S3Config = {
  bucket: string
  region?: string
  endpoint?: string
  forcePathStyle?: boolean
  credentialsEnvPrefix?: string
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function buildKey(namespace: string, scope: TenantScope, fileName: string): string {
  const orgSeg = scope.organizationId ? `org_${scope.organizationId}` : 'org_shared'
  const tenantSeg = scope.tenantId ? `tenant_${scope.tenantId}` : 'tenant_shared'
  const uniqueSuffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const safeName = sanitizeSegment(fileName || 'file')
  return `${sanitizeSegment(namespace)}/${orgSeg}/${tenantSeg}/${Date.now()}_${uniqueSuffix}_${safeName}`
}

export interface StorageService {
  upload(input: UploadInput): Promise<StorageResult>
  download(input: DownloadInput): Promise<{ buffer: Buffer; contentType?: string }>
  delete(input: DeleteInput): Promise<void>
  getSignedUrl(input: SignedUrlInput): Promise<{ url: string; expiresAt: Date }>
  list(input: ListInput): Promise<{
    files: Array<{ key: string; size: number; lastModified: Date }>
    truncated: boolean
    nextContinuationToken?: string
  }>
  toLocalPath(input: { key: string; scope: TenantScope }): Promise<{ filePath: string; cleanup: () => Promise<void> }>
}

export function createStorageService(config: S3Config): StorageService {
  const driver = new S3StorageDriver(config as Record<string, unknown>)

  return {
    async upload({ namespace, fileName, buffer, contentType, scope }): Promise<StorageResult> {
      const stored = await driver.store({
        partitionCode: namespace,
        orgId: scope.organizationId,
        tenantId: scope.tenantId,
        fileName,
        buffer,
      })
      return {
        key: stored.storagePath,
        namespace,
        fileName,
        size: buffer.length,
        contentType,
      }
    },

    async download({ key }): Promise<{ buffer: Buffer; contentType?: string }> {
      return driver.read('', key)
    },

    async delete({ key }): Promise<void> {
      return driver.delete('', key)
    },

    async getSignedUrl({ key, operation, expiresIn = 3600, contentType }): Promise<{ url: string; expiresAt: Date }> {
      const url = await driver.getSignedUrl(key, operation, expiresIn, contentType)
      return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) }
    },

    async list({ prefix, maxKeys = 100, continuationToken }): Promise<{
      files: Array<{ key: string; size: number; lastModified: Date }>
      truncated: boolean
      nextContinuationToken?: string
    }> {
      return driver.listObjects(prefix, maxKeys, continuationToken)
    },

    async toLocalPath({ key }) {
      return driver.toLocalPath('', key)
    },
  }
}
