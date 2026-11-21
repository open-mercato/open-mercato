/** @jest-environment node */

const mockRegisterExternalStorageDriver = jest.fn()
const mockRegisterExternalCredentialEnhancer = jest.fn()

jest.mock('@open-mercato/core/modules/attachments/lib/drivers', () => ({
  registerStorageDriverValidator: jest.fn(),
  getAttachmentStoragePolicy: () => process.env.OM_ATTACHMENT_STORAGE_POLICY ?? 'legacy',
  registerExternalStorageDriver: (...args: unknown[]) => mockRegisterExternalStorageDriver(...args),
  registerExternalCredentialEnhancer: (...args: unknown[]) => mockRegisterExternalCredentialEnhancer(...args),
}))

import { asValue, createContainer } from 'awilix'
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


describe('storage_s3 tenant service credentials', () => {
  it.each([
    { bucket: 'tenant-bucket', region: 'eu-central-1', authMode: 'ambient' },
    { bucket: 'tenant-bucket', region: 'eu-central-1', credentialsEnvPrefix: 'AWS' },
    { bucket: 'tenant-bucket', region: 'eu-central-1', accessKeyId: '', secretAccessKey: '' },
  ])('rejects unsafe stored credentials through the DI service: %j', async (credentials) => {
    const resolveCredentials = jest.fn().mockResolvedValue(credentials)
    const container = createContainer()
    container.register({
      integrationCredentialsService: asValue({ resolve: resolveCredentials }),
      attachmentQuotaService: asValue({}),
    })
    register(container)
    const service = container.resolve('storageService')
    await expect(service._resolveService({ tenantId: 'tenant-1', organizationId: 'org-1' }))
      .rejects.toThrow(/explicit access keys/)
    expect(resolveCredentials).toHaveBeenCalledWith('storage_s3', { tenantId: 'tenant-1', organizationId: 'org-1' })
  })
})
