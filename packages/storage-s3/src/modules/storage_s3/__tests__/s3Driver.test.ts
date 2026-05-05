/** @jest-environment node */
import { Readable } from 'stream'

const mockSend = jest.fn()

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn().mockImplementation((params) => ({ _type: 'PutObject', ...params })),
  GetObjectCommand: jest.fn().mockImplementation((params) => ({ _type: 'GetObject', ...params })),
  DeleteObjectCommand: jest.fn().mockImplementation((params) => ({ _type: 'DeleteObject', ...params })),
  ListObjectsV2Command: jest.fn().mockImplementation((params) => ({ _type: 'ListObjectsV2', ...params })),
}))

const mockGetSignedUrl = jest.fn().mockResolvedValue('https://presigned.example.com/object?sig=abc')
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}))

const mockMkdir = jest.fn().mockResolvedValue(undefined)
const mockWriteFile = jest.fn().mockResolvedValue(undefined)
const mockRm = jest.fn().mockResolvedValue(undefined)

jest.mock('fs', () => ({
  promises: {
    mkdir: (...a: unknown[]) => mockMkdir(...a),
    writeFile: (...a: unknown[]) => mockWriteFile(...a),
    rm: (...a: unknown[]) => mockRm(...a),
  },
}))

import { S3Client } from '@aws-sdk/client-s3'
import { S3StorageDriver } from '../lib/s3-driver'

const BASE_CONFIG = { bucket: 'test-bucket', region: 'eu-central-1' }

function makeStream(data: Buffer): NodeJS.ReadableStream {
  return Readable.from([data]) as unknown as NodeJS.ReadableStream
}

beforeEach(() => {
  mockSend.mockReset()
  mockGetSignedUrl.mockReset()
  mockGetSignedUrl.mockResolvedValue('https://presigned.example.com/object?sig=abc')
  ;(S3Client as jest.Mock).mockClear()
})

describe('S3StorageDriver', () => {
  describe('constructor — credential resolution', () => {
    it('uses direct accessKeyId/secretAccessKey when provided', () => {
      new S3StorageDriver({ ...BASE_CONFIG, accessKeyId: 'AKID', secretAccessKey: 'SECRET' })
      const [[arg]] = (S3Client as jest.Mock).mock.calls
      expect(arg.credentials).toEqual({ accessKeyId: 'AKID', secretAccessKey: 'SECRET' })
    })

    it('includes sessionToken when provided with direct keys', () => {
      new S3StorageDriver({ ...BASE_CONFIG, accessKeyId: 'AKID', secretAccessKey: 'SECRET', sessionToken: 'TOKEN' })
      const [[arg]] = (S3Client as jest.Mock).mock.calls
      expect(arg.credentials).toEqual({ accessKeyId: 'AKID', secretAccessKey: 'SECRET', sessionToken: 'TOKEN' })
    })

    it('reads credentials from env when credentialsEnvPrefix is set', () => {
      process.env['MYPFX_ACCESS_KEY_ID'] = 'ENV_AKID'
      process.env['MYPFX_SECRET_ACCESS_KEY'] = 'ENV_SECRET'
      new S3StorageDriver({ ...BASE_CONFIG, credentialsEnvPrefix: 'MYPFX' })
      const [[arg]] = (S3Client as jest.Mock).mock.calls
      expect(arg.credentials).toEqual({ accessKeyId: 'ENV_AKID', secretAccessKey: 'ENV_SECRET' })
      delete process.env['MYPFX_ACCESS_KEY_ID']
      delete process.env['MYPFX_SECRET_ACCESS_KEY']
    })

    it('reads sessionToken from env when credentialsEnvPrefix is set', () => {
      process.env['MYPFX_ACCESS_KEY_ID'] = 'ENV_AKID'
      process.env['MYPFX_SECRET_ACCESS_KEY'] = 'ENV_SECRET'
      process.env['MYPFX_SESSION_TOKEN'] = 'ENV_TOKEN'
      new S3StorageDriver({ ...BASE_CONFIG, credentialsEnvPrefix: 'MYPFX' })
      const [[arg]] = (S3Client as jest.Mock).mock.calls
      expect(arg.credentials).toEqual({ accessKeyId: 'ENV_AKID', secretAccessKey: 'ENV_SECRET', sessionToken: 'ENV_TOKEN' })
      delete process.env['MYPFX_ACCESS_KEY_ID']
      delete process.env['MYPFX_SECRET_ACCESS_KEY']
      delete process.env['MYPFX_SESSION_TOKEN']
    })

    it('ignores access keys when authMode is ambient', () => {
      new S3StorageDriver({ ...BASE_CONFIG, authMode: 'ambient', accessKeyId: 'AKID', secretAccessKey: 'SECRET' })
      const [[arg]] = (S3Client as jest.Mock).mock.calls
      expect(arg.credentials).toBeUndefined()
    })

    it('passes no credentials when neither prefix nor direct keys are configured', () => {
      new S3StorageDriver(BASE_CONFIG)
      const [[arg]] = (S3Client as jest.Mock).mock.calls
      expect(arg.credentials).toBeUndefined()
    })

    it('applies forcePathStyle and custom endpoint', () => {
      new S3StorageDriver({ ...BASE_CONFIG, endpoint: 'http://minio:9000', forcePathStyle: true })
      const [[arg]] = (S3Client as jest.Mock).mock.calls
      expect(arg.endpoint).toBe('http://minio:9000')
      expect(arg.forcePathStyle).toBe(true)
    })
  })

  describe('store()', () => {
    it('constructs key as <partitionCode>/org_<orgId>/tenant_<tenantId>/...', async () => {
      mockSend.mockResolvedValueOnce({})
      const driver = new S3StorageDriver(BASE_CONFIG)
      const result = await driver.store({
        partitionCode: 'docs',
        orgId: 'org-1',
        tenantId: 'tenant-2',
        fileName: 'report.pdf',
        buffer: Buffer.from('pdf-data'),
      })

      expect(result.storagePath).toMatch(/^docs\/org_org-1\/tenant_tenant-2\//)
      expect(result.storagePath).toContain('report.pdf')

      const cmd = mockSend.mock.calls[0][0]
      expect(cmd.Bucket).toBe('test-bucket')
      expect(cmd.Key).toBe(result.storagePath)
    })

    it('sanitizes dangerous characters in fileName', async () => {
      mockSend.mockResolvedValueOnce({})
      const driver = new S3StorageDriver(BASE_CONFIG)
      const result = await driver.store({
        partitionCode: 'docs',
        orgId: 'org-1',
        tenantId: 'tenant-2',
        fileName: 'bad name; rm -rf *.pdf',
        buffer: Buffer.from('x'),
      })
      expect(result.storagePath).not.toMatch(/[\s;*]/)
    })

    it('falls back to org_shared/tenant_shared when orgId/tenantId are absent', async () => {
      mockSend.mockResolvedValueOnce({})
      const driver = new S3StorageDriver(BASE_CONFIG)
      const result = await driver.store({
        partitionCode: 'docs',
        orgId: null,
        tenantId: undefined,
        fileName: 'file.txt',
        buffer: Buffer.from('x'),
      })
      expect(result.storagePath).toMatch(/^docs\/org_shared\/tenant_shared\//)
    })

    it('prepends pathPrefix when configured', async () => {
      mockSend.mockResolvedValueOnce({})
      const driver = new S3StorageDriver({ ...BASE_CONFIG, pathPrefix: 'backups/' })
      const result = await driver.store({
        partitionCode: 'docs',
        orgId: 'o',
        tenantId: 't',
        fileName: 'x.txt',
        buffer: Buffer.from('x'),
      })
      expect(result.storagePath).toMatch(/^backups\/docs\//)
    })
  })

  describe('read()', () => {
    it('calls GetObjectCommand with the given storagePath as Key', async () => {
      mockSend.mockResolvedValueOnce({
        Body: makeStream(Buffer.from('bytes')),
        ContentType: 'image/png',
      })
      const driver = new S3StorageDriver(BASE_CONFIG)
      const result = await driver.read('', 'docs/org_o/tenant_t/img.png')

      expect(result.contentType).toBe('image/png')
      expect(Buffer.isBuffer(result.buffer)).toBe(true)
      const cmd = mockSend.mock.calls[0][0]
      expect(cmd.Key).toBe('docs/org_o/tenant_t/img.png')
      expect(cmd.Bucket).toBe('test-bucket')
    })
  })

  describe('delete()', () => {
    it('calls DeleteObjectCommand with the correct Key', async () => {
      mockSend.mockResolvedValueOnce({})
      const driver = new S3StorageDriver(BASE_CONFIG)
      await driver.delete('', 'docs/org_o/tenant_t/file.txt')

      const cmd = mockSend.mock.calls[0][0]
      expect(cmd._type).toBe('DeleteObject')
      expect(cmd.Key).toBe('docs/org_o/tenant_t/file.txt')
    })

    it('does not throw when S3 delete fails (best-effort)', async () => {
      mockSend.mockRejectedValueOnce(new Error('NoSuchKey'))
      const driver = new S3StorageDriver(BASE_CONFIG)
      await expect(driver.delete('', 'missing.txt')).resolves.not.toThrow()
    })
  })

  describe('getSignedUrl()', () => {
    it('delegates to @aws-sdk/s3-request-presigner for download', async () => {
      const driver = new S3StorageDriver(BASE_CONFIG)
      const url = await driver.getSignedUrl('docs/org_o/tenant_t/file.pdf', 'download', 600)

      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1)
      expect(url).toBe('https://presigned.example.com/object?sig=abc')
    })

    it('delegates to @aws-sdk/s3-request-presigner for upload', async () => {
      const driver = new S3StorageDriver(BASE_CONFIG)
      await driver.getSignedUrl('docs/org_o/tenant_t/file.pdf', 'upload', 3600, 'application/pdf')

      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1)
    })
  })

  describe('listObjects()', () => {
    it('returns files from S3 response', async () => {
      mockSend.mockResolvedValueOnce({
        Contents: [
          { Key: 'docs/org_o/tenant_t/a.txt', Size: 100, LastModified: new Date('2026-01-01') },
          { Key: 'docs/org_o/tenant_t/b.txt', Size: 200, LastModified: new Date('2026-01-02') },
        ],
        IsTruncated: false,
      })
      const driver = new S3StorageDriver(BASE_CONFIG)
      const result = await driver.listObjects('docs/org_o/tenant_t/', 50)

      expect(result.files).toHaveLength(2)
      expect(result.files[0].key).toBe('docs/org_o/tenant_t/a.txt')
      expect(result.truncated).toBe(false)
    })

    it('passes continuationToken when provided', async () => {
      mockSend.mockResolvedValueOnce({ Contents: [], IsTruncated: false })
      const driver = new S3StorageDriver(BASE_CONFIG)
      await driver.listObjects('prefix/', 10, 'tok-123')

      const cmd = mockSend.mock.calls[0][0]
      expect(cmd.ContinuationToken).toBe('tok-123')
    })
  })
})
