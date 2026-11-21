/** @jest-environment node */

const mockResolveCredentials = jest.fn()
const mockSend = jest.fn()
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
  ListObjectsV2Command: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ tenantId: 'tenant-1', orgId: 'org-1' }),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string) => key }),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => ({ resolve: mockResolveCredentials }) }),
}))

import { S3Client } from '@aws-sdk/client-s3'
import { GET as download } from '../api/get/storage-providers/s3/download'
import { GET as list } from '../api/get/storage-providers/s3/list'
import { DELETE as remove } from '../api/delete/storage-providers/s3/delete'
import { POST as sign } from '../api/post/storage-providers/s3/signed-url'
import { POST as upload } from '../api/post/storage-providers/s3/upload'
import { buildTenantS3DriverConfig } from '../lib/tenant-credentials'

const key = 'docs/org_org-1/tenant_tenant-1/report.txt'
const bucketConfig = { bucket: 'tenant-bucket', region: 'eu-central-1' }

function jsonRequest(method: string, body: unknown) {
  return new Request('http://localhost/api/storage-providers/s3', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => jest.clearAllMocks())

it.each([
  bucketConfig,
  { ...bucketConfig, authMode: 'ambient' },
  { ...bucketConfig, authMode: 'access_keys', accessKeyId: '', secretAccessKey: '' },
  { ...bucketConfig, credentialsEnvPrefix: 'AWS' },
  { ...bucketConfig, accessKeyId: 'tenant-key', secretAccessKey: 'tenant-secret', pathPrefix: 'injected/' },
])('rejects stored unsafe credentials at every standalone boundary: %j', async (credentials) => {
  mockResolveCredentials.mockResolvedValue(credentials)
  const form = new FormData()
  form.set('file', new File(['report'], 'report.txt', { type: 'text/plain' }))
  const responses = await Promise.all([
    download(new Request(`http://localhost/api/storage-providers/s3/download?key=${key}`)),
    list(new Request('http://localhost/api/storage-providers/s3/list')),
    remove(jsonRequest('DELETE', { key })),
    sign(jsonRequest('POST', { key, operation: 'download' })),
    upload(new Request('http://localhost/api/storage-providers/s3/upload', { method: 'POST', body: form })),
  ])
  for (const response of responses) {
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'storage_s3.errors.integrationNotConfigured' })
  }
  expect(mockResolveCredentials).toHaveBeenCalledTimes(5)
  expect(mockResolveCredentials).toHaveBeenCalledWith('storage_s3', { tenantId: 'tenant-1', organizationId: 'org-1' })
  expect(S3Client).not.toHaveBeenCalled()
  expect(mockSend).not.toHaveBeenCalled()
})

it('builds only declared credentials with authenticated scope', () => {
  const credentials = { ...bucketConfig, accessKeyId: 'tenant-key', secretAccessKey: 'tenant-secret', sessionToken: 'tenant-token' }
  expect(buildTenantS3DriverConfig(credentials, { tenantId: 'tenant-1', organizationId: 'org-1' })).toEqual({
    ...credentials,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
  })
})
