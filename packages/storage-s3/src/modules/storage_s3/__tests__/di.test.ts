/** @jest-environment node */

const mockRegisterExternalStorageDriver = jest.fn()
const mockRegisterExternalCredentialEnhancer = jest.fn()

jest.mock('@open-mercato/core/modules/attachments/lib/drivers', () => ({
  registerStorageDriverValidator: jest.fn(),
  getAttachmentStoragePolicy: () => process.env.OM_ATTACHMENT_STORAGE_POLICY ?? 'legacy',
  registerExternalStorageDriver: (...args: unknown[]) => mockRegisterExternalStorageDriver(...args),
  registerExternalCredentialEnhancer: (...args: unknown[]) => mockRegisterExternalCredentialEnhancer(...args),
}))

import { register } from '../di'
import { asValue, createContainer } from 'awilix'
import { getProcessDiRegistrar, runProcessActivations } from '@open-mercato/shared/lib/di/process-registrar'
import { runWithRequestScopeContainer } from '@open-mercato/shared/lib/di/request-scope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { registerExternalCredentialEnhancer } from '@open-mercato/core/modules/attachments/lib/drivers'

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))

type CredentialEnhancer = Parameters<typeof registerExternalCredentialEnhancer>[1]

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


describe('storage_s3 process credential enhancer', () => {
  beforeEach(() => {
    mockRegisterExternalCredentialEnhancer.mockClear()
    jest.mocked(createRequestContainer).mockReset()
  })

  it('uses the invoking scope and passes explicit tenant/organization through unchanged', async () => {
    const root = createContainer()
    await getProcessDiRegistrar(register)!(root)
    expect(mockRegisterExternalCredentialEnhancer).not.toHaveBeenCalled()
    runProcessActivations(root)
    const enhancer = mockRegisterExternalCredentialEnhancer.mock.calls.at(-1)![1] as CredentialEnhancer
    const firstCredentials = jest.fn(async () => ({ accessKeyId: 'first-key', secretAccessKey: 'first-secret' }))
    const secondCredentials = jest.fn(async () => ({ accessKeyId: 'second-key', secretAccessKey: 'second-secret' }))
    const first = root.createScope().register({ integrationCredentialsService: asValue({ resolve: firstCredentials }) })
    const second = root.createScope().register({ integrationCredentialsService: asValue({ resolve: secondCredentials }) })
    const firstScope = { tenantId: 'tenant-a', organizationId: 'org-a' }
    const secondScope = { tenantId: 'tenant-b', organizationId: 'org-b' }
    const [firstConfig, secondConfig] = await Promise.all([
      runWithRequestScopeContainer(first, () => enhancer({ bucket: 'first' }, firstScope)),
      runWithRequestScopeContainer(second, () => enhancer({ bucket: 'second' }, secondScope)),
    ])
    expect(firstConfig).toMatchObject({ ...firstScope, accessKeyId: 'first-key' })
    expect(secondConfig).toMatchObject({ ...secondScope, accessKeyId: 'second-key' })
    expect(firstCredentials).toHaveBeenCalledWith('storage_s3', firstScope)
    expect(secondCredentials).toHaveBeenCalledWith('storage_s3', secondScope)
    expect(createRequestContainer).not.toHaveBeenCalled()
  })

  it('creates and disposes its own caller outside execution context', async () => {
    const root = createContainer()
    await getProcessDiRegistrar(register)!(root)
    runProcessActivations(root)
    const enhancer = mockRegisterExternalCredentialEnhancer.mock.calls.at(-1)![1] as CredentialEnhancer
    const credentials = jest.fn(async () => null)
    const caller = root.createScope().register({ integrationCredentialsService: asValue({ resolve: credentials }) })
    const dispose = jest.spyOn(caller, 'dispose')
    jest.mocked(createRequestContainer).mockResolvedValue(caller)
    const scope = { tenantId: 'tenant', organizationId: 'org' }
    await expect(enhancer({ bucket: 'owned' }, scope)).resolves.toEqual({ bucket: 'owned', ...scope })
    expect(credentials).toHaveBeenCalledWith('storage_s3', scope)
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
