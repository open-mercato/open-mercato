/** @jest-environment node */

const mockSend = jest.fn()

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  HeadBucketCommand: jest.fn().mockImplementation((params) => ({ _type: 'HeadBucket', ...params })),
}))

import { S3Client } from '@aws-sdk/client-s3'
import { s3HealthCheck } from '../lib/health'

const BASE_CREDENTIALS = {
  bucket: 'test-bucket',
  region: 'eu-central-1',
  authMode: 'access_keys',
  accessKeyId: 'AKID',
  secretAccessKey: 'SECRET',
}

beforeEach(() => {
  mockSend.mockReset()
  ;(S3Client as jest.Mock).mockClear()
})

describe('s3HealthCheck', () => {
  it('rejects link-local custom endpoints before probing the bucket', async () => {
    const result = await s3HealthCheck.check({
      ...BASE_CREDENTIALS,
      endpoint: 'http://169.254.169.254/latest/meta-data/',
    })

    expect(result.status).toBe('unhealthy')
    expect(result.message).toMatch(/private or reserved IP range/i)
    expect(S3Client).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })
})
