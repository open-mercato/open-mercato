import type { EntityManager } from '@mikro-orm/postgresql'
import { LocalStorageDriver, StorageDriverFactory, registerExternalStorageDriver, registerStorageDriverValidator } from '../../attachments/lib/drivers'
import type { StorageDriver } from '../../attachments/lib/drivers'
import { AttachmentStorageConfigurationError } from '../../attachments/lib/drivers/storageValidation'
import { clearAttachmentThumbnailCache } from '../../attachments/lib/thumbnailCache'
import { GET, DELETE, PUT } from '../api/portal/attachments/route'

jest.mock('../lib/portalAuthGuard', () => ({ resolveLinkedCustomerAuth: async () => mockAuth }))
jest.mock('../lib/portalClaimAccess', () => ({ loadPortalOwnedClaim: async () => mockOwned ? { id: claimId } : null }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => ({ resolve: mockResolve }) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (_em: unknown, _entity: unknown, where: Record<string, unknown>) =>
    where.tenantId === attachment.tenantId && where.organizationId === attachment.organizationId ? attachment : null,
  findWithDecryption: async () => [],
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({
  t: (key: string, fallback?: string) => key === 'attachments.errors.storageConfigurationInvalid' ? 'Localized storage unavailable' : fallback ?? key,
  translate: (_key: string, fallback?: string) => fallback,
}) }))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: async () => ({ ok: true, runAfterSuccess: mockAfterSuccess }),
}))
jest.mock('../../attachments/lib/thumbnailCache', () => ({ clearAttachmentThumbnailCache: jest.fn(async () => undefined) }))
jest.mock('../lib/portalAttachmentUpload', () => ({ resolvePortalAttachmentUploadService: () => ({ upload: mockUpload }) }))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({ emitCrudSideEffects: jest.fn() }))

const claimId = '123e4567-e89b-42d3-a456-426614174001'
const attachmentId = '123e4567-e89b-42d3-a456-426614174002'
const attachment = {
  id: attachmentId, entityId: 'warranty_claims:warranty_claim', recordId: claimId,
  tenantId: 'tenant-1', organizationId: 'org-1', partitionCode: 'privateAttachments',
  storagePath: 'private/file', storageMetadata: { tags: ['customer-visible'] }, fileName: 'file.txt', fileSize: 4,
}
let mockAuth: Record<string, unknown> | null
let mockOwned: boolean
let mockPartition: Record<string, unknown> | null
let mockReferenceIds: string[]
let mockRetained: boolean
const mockAfterSuccess = jest.fn(async () => undefined)
const mockUpload = jest.fn(async () => ({ ...attachment, id: 'new-attachment' }))
const driver: StorageDriver = {
  key: 'portal-storage-test',
  store: jest.fn(async () => ({ storagePath: 'new/file' })),
  read: jest.fn(async () => ({ buffer: Buffer.from('file') })),
  delete: jest.fn(async () => undefined),
  toLocalPath: jest.fn(async () => ({ filePath: '/unused', cleanup: async () => undefined })),
}
const construct = jest.fn(() => driver)
const chain = {
  select: () => chain, where: () => chain, orderBy: () => chain, forUpdate: () => chain,
  execute: async () => mockReferenceIds.map((id) => ({ id })),
}
const mockEm = {
  findOne: jest.fn(async () => mockPartition),
  getKysely: () => ({ selectFrom: () => chain }),
  remove: jest.fn(() => { mockRetained = false }),
  flush: jest.fn(async () => undefined), begin: jest.fn(async () => undefined),
  commit: jest.fn(async () => undefined), rollback: jest.fn(async () => undefined),
}
function mockResolve(key: string): unknown {
  if (key === 'em') return mockEm
  if (key === 'storageDriverFactory') return new StorageDriverFactory(mockEm as unknown as EntityManager)
  return null
}
const previousPolicy = process.env.OM_ATTACHMENT_STORAGE_POLICY
let unregister: () => void
beforeAll(() => {
  registerExternalStorageDriver(driver.key, construct)
  unregister = registerStorageDriverValidator(driver.key, ({ config }) => config.bucket === 'valid')
})
afterAll(() => unregister())
beforeEach(() => {
  jest.clearAllMocks()
  mockAuth = { sub: 'customer-1', email: 'user@example.com', tenantId: 'tenant-1', orgId: 'org-1', customerEntityId: 'customer-1' }
  mockOwned = true
  mockRetained = true
  mockReferenceIds = [attachmentId]
  mockPartition = { code: 'privateAttachments', storageDriver: driver.key, configJson: { bucket: 'valid' }, isPublic: false }
  process.env.OM_ATTACHMENT_STORAGE_POLICY = 'strict'
})
afterEach(() => {
  if (previousPolicy === undefined) delete process.env.OM_ATTACHMENT_STORAGE_POLICY
  else process.env.OM_ATTACHMENT_STORAGE_POLICY = previousPolicy
})
function request(method: 'GET' | 'DELETE' | 'PUT'): Request {
  if (method === 'PUT') {
    const form = new FormData()
    form.set('claimId', claimId)
    form.set('attachmentId', attachmentId)
    form.set('file', new File(['replacement'], 'replacement.txt', { type: 'text/plain' }))
    return new Request('http://localhost/api/warranty_claims/portal/attachments', { method, body: form })
  }
  return new Request(`http://localhost/api/warranty_claims/portal/attachments?attachmentId=${attachmentId}`, { method })
}
describe.each([
  ['download', GET, 'GET'], ['delete', DELETE, 'DELETE'], ['replacement', PUT, 'PUT'],
] as const)('portal %s strict storage rejection', (_name, handler, method) => {
  it.each([
    ['missing partition', null, 'partition_missing'],
    ['unknown driver', { storageDriver: 'unknown', configJson: {} }, 'unknown_driver'],
    ['invalid config', { storageDriver: driver.key, configJson: 'secret-sentinel' }, 'invalid_config'],
    ['rejected config', { storageDriver: driver.key, configJson: { bucket: 'secret-sentinel' } }, 'validator_rejected'],
  ] as const)('%s returns a localized redacted 503 without side effects', async (_case, invalid, reason) => {
    mockPartition = invalid === null ? null : { code: 'privateAttachments', isPublic: false, ...invalid }
    const response = await handler(request(method))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Localized storage unavailable', code: 'ATTACHMENT_STORAGE_CONFIGURATION_INVALID', reason })
    expect(mockRetained).toBe(true)
    expect(mockEm.begin).not.toHaveBeenCalled()
    expect(mockEm.remove).not.toHaveBeenCalled()
    expect(clearAttachmentThumbnailCache).not.toHaveBeenCalled()
    expect(construct).not.toHaveBeenCalled()
    expect(driver.read).not.toHaveBeenCalled()
    expect(driver.delete).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockAfterSuccess).not.toHaveBeenCalled()
  })
})
it.each([['strict'], ['legacy']])('%s preserves shared bytes and commits before final-reference deletion', async (policy) => {
  process.env.OM_ATTACHMENT_STORAGE_POLICY = policy
  mockReferenceIds = [attachmentId, 'copy-id']
  expect((await DELETE(request('DELETE'))).status).toBe(200)
  expect(mockRetained).toBe(false)
  expect(driver.delete).not.toHaveBeenCalled()
  if (policy === 'legacy') expect(construct).not.toHaveBeenCalled()
  mockReferenceIds = [attachmentId]
  expect((await DELETE(request('DELETE'))).status).toBe(200)
  expect(driver.delete).toHaveBeenCalledWith('privateAttachments', 'private/file')
  expect(mockEm.commit.mock.invocationCallOrder[1]).toBeLessThan(jest.mocked(driver.delete).mock.invocationCallOrder[0])
})
it('does not delete storage or thumbnails after a concurrent row removal', async () => {
  mockReferenceIds = []
  expect((await DELETE(request('DELETE'))).status).toBe(200)
  expect(mockEm.remove).not.toHaveBeenCalled()
  expect(driver.delete).not.toHaveBeenCalled()
  expect(clearAttachmentThumbnailCache).not.toHaveBeenCalled()
})
it('maps typed provider read rejection without treating it as a missing file', async () => {
  jest.mocked(driver.read).mockRejectedValueOnce(new AttachmentStorageConfigurationError('invalid_config'))
  const response = await GET(request('GET'))
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({
    error: 'Localized storage unavailable', code: 'ATTACHMENT_STORAGE_CONFIGURATION_INVALID', reason: 'invalid_config',
  })
})
it('preserves the missing-file response for operational read failures', async () => {
  jest.mocked(driver.read).mockRejectedValueOnce(new Error('[internal] file unavailable'))
  expect((await GET(request('GET'))).status).toBe(404)
})
it('retains legacy metadata deletion when the provider cannot be resolved', async () => {
  process.env.OM_ATTACHMENT_STORAGE_POLICY = 'legacy'
  construct.mockImplementationOnce(() => { throw new Error('[internal] provider unavailable') })
  expect((await DELETE(request('DELETE'))).status).toBe(200)
  expect(mockRetained).toBe(false)
  expect(mockAfterSuccess).toHaveBeenCalledTimes(1)
  expect(driver.delete).not.toHaveBeenCalled()
})
it.each(['GET', 'DELETE'] as const)('keeps missing legacy partitions on the existing %s path', async (method) => {
  process.env.OM_ATTACHMENT_STORAGE_POLICY = 'legacy'
  mockPartition = null
  const cleanup = jest.spyOn(LocalStorageDriver.prototype, 'delete').mockResolvedValue(undefined)
  try {
    if (method === 'GET') expect((await GET(request(method))).status).toBe(500)
    else expect((await DELETE(request(method))).status).toBe(200)
  } finally {
    cleanup.mockRestore()
  }
})
it('denies an unowned claim before resolving storage', async () => {
  mockOwned = false
  mockPartition = null
  expect((await DELETE(request('DELETE'))).status).toBe(404)
  expect(mockEm.findOne).not.toHaveBeenCalled()
  expect(mockEm.remove).not.toHaveBeenCalled()
})
it('denies a foreign tenant before resolving storage', async () => {
  mockAuth = { ...mockAuth, tenantId: 'foreign-tenant' }
  expect((await GET(request('GET'))).status).toBe(404)
  expect(mockEm.findOne).not.toHaveBeenCalled()
})
