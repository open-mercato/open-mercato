import type { EntityManager } from '@mikro-orm/postgresql'
import { StorageDriverFactory, registerExternalStorageDriver, registerExternalCredentialEnhancer } from '../driverFactory'
import { AttachmentStorageConfigurationError, getAttachmentStoragePolicy, isAttachmentStorageConfigurationError, registerStorageDriverValidator } from '../storageValidation'
import type { StorageDriver } from '../types'

const findOne = jest.fn()
const em = { findOne } as unknown as EntityManager
const scope = { tenantId: 'tenant-test', organizationId: 'org-test' }
const previousPolicy = process.env.OM_ATTACHMENT_STORAGE_POLICY
const cleanup: Array<() => void> = []
let sequence = 0

function fixture() {
  const driverKey = `validation-test-${sequence++}`
  const driver: StorageDriver = {
    key: driverKey,
    store: jest.fn(async () => ({ storagePath: 'safe/path' })),
    read: jest.fn(async () => ({ buffer: Buffer.from('bytes') })),
    delete: jest.fn(async () => undefined),
    toLocalPath: jest.fn(async () => ({ filePath: '/safe/path', cleanup: async () => undefined })),
  }
  const construct = jest.fn(() => driver)
  registerExternalStorageDriver(driverKey, construct)
  findOne.mockResolvedValue({ storageDriver: driverKey, configJson: { bucket: 'private-bucket' } })
  return { driverKey, driver, construct, factory: new StorageDriverFactory(em) }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.OM_ATTACHMENT_STORAGE_POLICY = 'strict'
})

afterEach(() => {
  cleanup.splice(0).forEach((unregister) => unregister())
  if (previousPolicy === undefined) delete process.env.OM_ATTACHMENT_STORAGE_POLICY
  else process.env.OM_ATTACHMENT_STORAGE_POLICY = previousPolicy
})

it('requires a provider validator before construction', async () => {
  const { factory, construct } = fixture()
  await expect(factory.resolveForPartition('privateAttachments', scope)).rejects.toMatchObject({ reason: 'validator_missing' })
  expect(construct).not.toHaveBeenCalled()
})

it('preserves the caller scope and validates both stages before using a driver', async () => {
  const { factory, driver, driverKey, construct } = fixture()
  const validate = jest.fn(() => true)
  cleanup.push(registerStorageDriverValidator(driverKey, validate))
  await expect(factory.resolveForPartition('privateAttachments', scope)).resolves.toBe(driver)
  expect(validate.mock.calls).toEqual([
    [{ driverKey, config: { bucket: 'private-bucket' }, scope, partitionCode: 'privateAttachments', stage: 'configured' }],
    [{ driverKey, config: { bucket: 'private-bucket' }, scope, partitionCode: 'privateAttachments', stage: 'resolved' }],
  ])
  expect(construct).toHaveBeenCalledTimes(1)
})

it('revalidates cached and pre-existing factories after validator replacement', () => {
  const { factory, driverKey, driver, construct } = fixture()
  cleanup.push(registerStorageDriverValidator(driverKey, () => true))
  expect(factory.resolveForAttachment(driverKey, { bucket: 'same' })).toBe(driver)
  cleanup.push(registerStorageDriverValidator(driverKey, () => false))
  expect(() => factory.resolveForAttachment(driverKey, { bucket: 'same' })).toThrow(AttachmentStorageConfigurationError)
  expect(construct).toHaveBeenCalledTimes(1)
})

it('does not enhance rejected configuration or leak its secret', async () => {
  const { factory, driverKey, construct } = fixture()
  const enhance = jest.fn()
  factory.registerCredentialEnhancer(driverKey, enhance)
  cleanup.push(registerStorageDriverValidator(driverKey, () => { throw new Error('secret-sentinel'); }))
  const error: unknown = await factory.resolveForPartition('secret-partition', scope).catch((failure: unknown) => failure)
  expect(isAttachmentStorageConfigurationError(error)).toBe(true)
  expect(JSON.stringify(error)).not.toContain('secret')
  expect(String(error)).not.toContain('secret')
  expect(enhance).not.toHaveBeenCalled()
  expect(construct).not.toHaveBeenCalled()
})

it.each([null, [], 'secret-output'])('rejects structurally invalid enhanced output %#', async (output) => {
  const { factory, driverKey, construct } = fixture()
  cleanup.push(registerStorageDriverValidator(driverKey, () => true))
  factory.registerCredentialEnhancer(driverKey, async () => output as unknown as Record<string, unknown>)
  await expect(factory.resolveForPartition('privateAttachments', scope)).rejects.toMatchObject({ reason: 'invalid_config' })
  expect(construct).not.toHaveBeenCalled()
})

it('redacts enhancer exceptions before any constructor runs', async () => {
  const { factory, driverKey, construct } = fixture()
  cleanup.push(registerStorageDriverValidator(driverKey, () => true))
  factory.registerCredentialEnhancer(driverKey, async () => { throw new Error('secret-sentinel'); })
  const error: unknown = await factory.resolveForPartition('privateAttachments', scope).catch((failure: unknown) => failure)
  expect(error).toMatchObject({ reason: 'enhancement_failed', status: 503 })
  expect(JSON.stringify(error)).not.toContain('secret-sentinel')
  expect(construct).not.toHaveBeenCalled()
})

it('validates provider invariants after enhancement and does not share scoped drivers', async () => {
  const { factory, driverKey, construct } = fixture()
  cleanup.push(registerStorageDriverValidator(driverKey, ({ config, stage }) => stage === 'configured' || config.ready === true))
  factory.registerCredentialEnhancer(driverKey, async (config) => ({ ...config, ready: false }))
  await expect(factory.resolveForPartition('privateAttachments', scope)).rejects.toMatchObject({ reason: 'validator_rejected' })
  expect(construct).not.toHaveBeenCalled()
  factory.registerCredentialEnhancer(driverKey, async (config) => ({ ...config, ready: true }))
  await factory.resolveForPartition('privateAttachments', scope)
  await factory.resolveForPartition('privateAttachments', scope)
  expect(construct).toHaveBeenCalledTimes(2)
})

it('rejects partial tenant scope before credentials enhancement', async () => {
  const { factory, driverKey, construct } = fixture()
  const enhance = jest.fn()
  cleanup.push(registerStorageDriverValidator(driverKey, () => true))
  factory.registerCredentialEnhancer(driverKey, enhance)
  await expect(factory.resolveForPartition('privateAttachments', { tenantId: 'tenant-test', organizationId: '' })).rejects.toMatchObject({ reason: 'invalid_scope' })
  expect(enhance).not.toHaveBeenCalled()
  expect(construct).not.toHaveBeenCalled()
})

it('honors module registrations across a duplicated factory import', async () => {
  const { driverKey, driver } = fixture()
  cleanup.push(registerStorageDriverValidator(driverKey, () => true))
  const enhance = jest.fn(async (config: Record<string, unknown>) => config)
  registerExternalCredentialEnhancer(driverKey, enhance)
  let duplicatedFactory: StorageDriverFactory | undefined
  jest.isolateModules(() => {
    const duplicate = jest.requireActual<typeof import('../driverFactory')>('../driverFactory')
    duplicatedFactory = new duplicate.StorageDriverFactory(em)
  })
  await expect(duplicatedFactory?.resolveForPartition('privateAttachments', scope)).resolves.toBe(driver)
  expect(enhance).toHaveBeenCalledWith({ bucket: 'private-bucket' }, scope)
})

it('recognizes errors from another bundle without copying unsafe diagnostics', () => {
  const duplicate = { [Symbol.for('@open-mercato/AttachmentStorageConfigurationError')]: true }
  expect(isAttachmentStorageConfigurationError(duplicate)).toBe(true)
  expect(isAttachmentStorageConfigurationError(new Error('other'))).toBe(false)
})

it('retains explicit legacy fallback as the default', async () => {
  delete process.env.OM_ATTACHMENT_STORAGE_POLICY
  expect(getAttachmentStoragePolicy()).toBe('legacy')
  findOne.mockResolvedValue(null)
  const factory = new StorageDriverFactory(em)
  await expect(factory.resolveForPartition('missing')).resolves.toMatchObject({ key: 'local' })
  expect(factory.resolveForAttachment('unknown')).toMatchObject({ key: 'local' })
})

it.each(['local', 'legacyPublic'])('supports explicit %s with an empty default configuration', async (driverKey) => {
  findOne.mockResolvedValue({ storageDriver: driverKey, configJson: null })
  await expect(new StorageDriverFactory(em).resolveForPartition('global', { tenantId: '', organizationId: '' })).resolves.toMatchObject({ key: driverKey })
})
