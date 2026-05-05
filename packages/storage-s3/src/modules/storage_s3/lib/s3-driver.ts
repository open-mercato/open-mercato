import { randomUUID } from 'crypto'
import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { StorageDriver, StoreFilePayload, StoredFile, ReadFileResult } from '@open-mercato/core/modules/attachments/lib/drivers'

export type S3DriverConfig = {
  bucket: string
  region?: string
  endpoint?: string
  pathPrefix?: string
  forcePathStyle?: boolean
  /**
   * authMode:
   * - access_keys: use explicit credentials (direct values or env prefix)
   * - ambient: let AWS SDK resolve credentials from the default chain (STS/IRSA/instance profile/etc.)
   *
   * Backward compat: missing authMode behaves like access_keys when keys are provided; otherwise ambient.
   */
  authMode?: 'access_keys' | 'ambient'
  /** Resolve access key + secret from env vars: {PREFIX}_ACCESS_KEY_ID / {PREFIX}_SECRET_ACCESS_KEY */
  credentialsEnvPrefix?: string
  /** Direct credentials (used when passed from Integration Marketplace) */
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
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

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

export class S3StorageDriver implements StorageDriver {
  readonly key = 's3'
  private readonly client: S3Client
  private readonly bucket: string
  private readonly pathPrefix: string

  constructor(config: Record<string, unknown>) {
    const cfg = config as S3DriverConfig
    this.bucket = cfg.bucket
    this.pathPrefix = cfg.pathPrefix ?? ''

    const authMode = cfg.authMode
    const shouldUseAccessKeys =
      authMode === 'access_keys'
      || (
        authMode !== 'ambient'
        && ((cfg.accessKeyId && cfg.secretAccessKey) || Boolean(cfg.credentialsEnvPrefix))
      )

    let credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string } | undefined
    if (shouldUseAccessKeys) {
      if (cfg.credentialsEnvPrefix) {
        const prefix = cfg.credentialsEnvPrefix
        const accessKeyId = process.env[`${prefix}_ACCESS_KEY_ID`]
        const secretAccessKey = process.env[`${prefix}_SECRET_ACCESS_KEY`]
        const sessionToken = process.env[`${prefix}_SESSION_TOKEN`]
        if (accessKeyId && secretAccessKey) {
          credentials = { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) }
        }
      } else if (cfg.accessKeyId && cfg.secretAccessKey) {
        credentials = {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
          ...(cfg.sessionToken ? { sessionToken: cfg.sessionToken } : {}),
        }
      }
    }

    this.client = new S3Client({
      region: cfg.region ?? 'us-east-1',
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle ?? false,
      credentials,
    })
  }

  async store(payload: StoreFilePayload): Promise<StoredFile> {
    const orgSegment = resolveOrgSegment(payload.orgId ?? null)
    const tenantSegment = resolveTenantSegment(payload.tenantId ?? null)
    const safeName = sanitizeFileName(payload.fileName || 'file')
    const uniqueSuffix = randomUUID().replace(/-/g, '').slice(0, 12)
    const storedName = `${Date.now()}_${uniqueSuffix}_${safeName}`
    const key = `${this.pathPrefix}${payload.partitionCode}/${orgSegment}/${tenantSegment}/${storedName}`

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: payload.buffer,
        ContentLength: payload.buffer.length,
      }),
    )

    return { storagePath: key }
  }

  async read(_partitionCode: string, storagePath: string): Promise<ReadFileResult> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: storagePath }),
    )
    if (!response.Body) {
      throw new Error(`S3 object body is empty for key: ${storagePath}`)
    }
    const buffer = await streamToBuffer(response.Body as NodeJS.ReadableStream)
    return { buffer, contentType: response.ContentType }
  }

  async delete(_partitionCode: string, storagePath: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: storagePath }),
      )
    } catch {
      // best-effort removal
    }
  }

  async toLocalPath(
    partitionCode: string,
    storagePath: string,
  ): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
    const tmpDir = path.join(os.tmpdir(), `s3-tmp-${randomUUID()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    const fileName = path.basename(storagePath) || 'download'
    const filePath = path.join(tmpDir, fileName)
    const { buffer } = await this.read(partitionCode, storagePath)
    await fs.writeFile(filePath, buffer)
    return {
      filePath,
      cleanup: async () => {
        await fs.rm(tmpDir, { recursive: true, force: true })
      },
    }
  }

  /**
   * Put an object directly at a specific S3 key (for standalone usage).
   */
  async putObject(key: string, buffer: Buffer, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ContentLength: buffer.length,
      }),
    )
  }

  getBucket(): string {
    return this.bucket
  }

  async listObjects(
    prefix: string,
    maxKeys = 100,
    continuationToken?: string,
  ): Promise<{
    files: Array<{ key: string; size: number; lastModified: Date }>
    truncated: boolean
    nextContinuationToken?: string
  }> {
    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: maxKeys,
        ContinuationToken: continuationToken,
      }),
    )
    return {
      files: (response.Contents ?? []).map((obj) => ({
        key: obj.Key ?? '',
        size: obj.Size ?? 0,
        lastModified: obj.LastModified ?? new Date(0),
      })),
      truncated: response.IsTruncated ?? false,
      nextContinuationToken: response.NextContinuationToken,
    }
  }

  /**
   * Generate a pre-signed URL for direct browser upload or download.
   */
  async getSignedUrl(
    storagePath: string,
    operation: 'upload' | 'download',
    expiresIn = 3600,
    contentType?: string,
  ): Promise<string> {
    if (operation === 'upload') {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: storagePath,
        ContentType: contentType,
      })
      return getSignedUrl(this.client, command, { expiresIn })
    }
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: storagePath })
    return getSignedUrl(this.client, command, { expiresIn })
  }
}
