import { validateS3StorageConfiguration } from '../lib/storage-validation'

const previousInternal = process.env.OM_STORAGE_S3_ALLOW_INTERNAL_ENDPOINTS

afterEach(() => {
  if (previousInternal === undefined) delete process.env.OM_STORAGE_S3_ALLOW_INTERNAL_ENDPOINTS
  else process.env.OM_STORAGE_S3_ALLOW_INTERNAL_ENDPOINTS = previousInternal
  delete process.env.OM_TEST_STORAGE_ACCESS_KEY_ID
  delete process.env.OM_TEST_STORAGE_SECRET_ACCESS_KEY
})

it.each([
  { bucket: 'example' },
  { bucket: 'example', authMode: 'ambient' },
  { bucket: 'example', authMode: 'access_keys', accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
  { bucket: 'example', endpoint: 'http://storage.example.com', forcePathStyle: true },
])('accepts supported complete configuration %#', (config) => {
  expect(validateS3StorageConfiguration({ driverKey: 's3', config, stage: 'resolved' })).toBe(true)
})

it.each([
  {},
  { bucket: '' },
  { bucket: 'example', forcePathStyle: 'false' },
  { bucket: 'example', authMode: 'access_keys' },
  { bucket: 'example', accessKeyId: 'test-key' },
  { bucket: 'example', secretAccessKey: 'test-secret' },
  { bucket: 'example', authMode: 'ambient', accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
  { bucket: 'example', sessionToken: 'test-session' },
  { bucket: 'example', credentialsEnvPrefix: 'OM_TEST_STORAGE' },
  { bucket: 'example', endpoint: 'https://user:secret@storage.example.com' },
  { bucket: 'example', tenantId: 'tenant', organizationId: null },
])('rejects malformed or inconsistent final configuration %#', (config) => {
  expect(validateS3StorageConfiguration({ driverKey: 's3', config, stage: 'resolved' })).toBe(false)
})

it('permits incomplete marketplace configuration only before enhancement', () => {
  expect(validateS3StorageConfiguration({ driverKey: 's3', config: {}, stage: 'configured' })).toBe(true)
  expect(validateS3StorageConfiguration({ driverKey: 's3', config: {}, stage: 'resolved' })).toBe(false)
})

it('rejects a config that replaces the operation tenant scope', () => {
  expect(validateS3StorageConfiguration({
    driverKey: 's3', stage: 'resolved',
    config: { bucket: 'example', tenantId: 'other', organizationId: 'organization' },
    scope: { tenantId: 'tenant', organizationId: 'organization' },
  })).toBe(false)
})

it('supports configured environment credentials without copying them', () => {
  process.env.OM_TEST_STORAGE_ACCESS_KEY_ID = 'test-key'
  process.env.OM_TEST_STORAGE_SECRET_ACCESS_KEY = 'test-secret'
  expect(validateS3StorageConfiguration({ driverKey: 's3', stage: 'resolved', config: {
    bucket: 'example', credentialsEnvPrefix: 'OM_TEST_STORAGE',
  } })).toBe(true)
})
