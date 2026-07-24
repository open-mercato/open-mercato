/** @jest-environment node */

const mockRegisterExternalStorageDriver = jest.fn()
const mockRegisterExternalCredentialEnhancer = jest.fn()

jest.mock('@open-mercato/core/modules/attachments/lib/drivers', () => ({
  registerExternalStorageDriver: (...args: unknown[]) => mockRegisterExternalStorageDriver(...args),
  registerExternalCredentialEnhancer: (...args: unknown[]) => mockRegisterExternalCredentialEnhancer(...args),
}))

import { register } from '../di'

describe('storage_s3 DI registration', () => {
  beforeEach(() => {
    mockRegisterExternalCredentialEnhancer.mockClear()
  })

  it('keeps tenant scope on enhanced S3 config when credential resolution fails', async () => {
    const container = {
      register: jest.fn(),
      resolve: jest.fn().mockReturnValue({
        resolve: jest.fn().mockRejectedValue(new Error('credentials unavailable')),
      }),
    }

    register(container as never)

    const enhancer = mockRegisterExternalCredentialEnhancer.mock.calls.at(-1)?.[1]
    expect(enhancer).toBeDefined()

    await expect(
      enhancer(
        { bucket: 'tenant-bucket' },
        { organizationId: 'org-owned', tenantId: 'tenant-owned' },
      ),
    ).resolves.toMatchObject({
      bucket: 'tenant-bucket',
      organizationId: 'org-owned',
      tenantId: 'tenant-owned',
    })
  })
})
