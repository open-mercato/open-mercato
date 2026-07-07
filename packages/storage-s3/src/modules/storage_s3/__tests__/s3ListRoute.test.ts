/** @jest-environment node */

const tenantId = 'tenant-1'
const orgId = 'org-1'
const listObjectsMock = jest.fn()
const credentialsResolveMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ tenantId, orgId, sub: null }),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (token: string) => {
      if (token === 'integrationCredentialsService') {
        return { resolve: credentialsResolveMock }
      }
      throw new Error(`Unexpected container token: ${token}`)
    },
  }),
}))

jest.mock('../lib/s3-driver', () => ({
  S3StorageDriver: jest.fn().mockImplementation(() => ({
    listObjects: listObjectsMock,
  })),
}))

import { GET } from '../api/get/storage-providers/s3/list'

beforeEach(() => {
  jest.clearAllMocks()
  credentialsResolveMock.mockResolvedValue({ bucket: 'bucket', region: 'eu-central-1' })
  listObjectsMock.mockResolvedValue({
    files: [],
    truncated: false,
    nextContinuationToken: undefined,
  })
})

describe('storage_s3 list route tenant scoping', () => {
  it('scopes an unqualified namespace prefix to the authenticated tenant', async () => {
    const response = await GET(
      new Request('http://localhost/api/storage-providers/s3/list?prefix=exports/&maxKeys=25&continuationToken=next'),
    )

    expect(response.status).toBe(200)
    expect(listObjectsMock).toHaveBeenCalledWith(
      'exports/org_org-1/tenant_tenant-1/',
      25,
      'next',
    )
  })

  it('passes an already scoped tenant prefix through when it is structurally left anchored', async () => {
    const scopedPrefix = 'exports/org_org-1/tenant_tenant-1/reports/'
    const response = await GET(
      new Request(`http://localhost/api/storage-providers/s3/list?prefix=${encodeURIComponent(scopedPrefix)}`),
    )

    expect(response.status).toBe(200)
    expect(listObjectsMock).toHaveBeenCalledWith(scopedPrefix, 100, undefined)
  })

  it('rejects a prefix scoped to a different tenant before listing S3 objects', async () => {
    const response = await GET(
      new Request('http://localhost/api/storage-providers/s3/list?prefix=exports/org_other/tenant_tenant-1/'),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Access denied: prefix is not scoped to this tenant.',
    })
    expect(listObjectsMock).not.toHaveBeenCalled()
  })

  it('rejects a prefix that only contains the tenant scope later in the path', async () => {
    const response = await GET(
      new Request('http://localhost/api/storage-providers/s3/list?prefix=exports/archive/org_org-1/tenant_tenant-1/'),
    )

    expect(response.status).toBe(403)
    expect(listObjectsMock).not.toHaveBeenCalled()
  })
})
