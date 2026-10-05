import type { EntityManager } from '@mikro-orm/postgresql'
import type { NextRequest } from 'next/server'
import sharp from 'sharp'
import { StorageDriverFactory, registerExternalStorageDriver } from '../../lib/drivers/driverFactory'
import { registerStorageDriverValidator } from '../../lib/drivers/storageValidation'
import type { StorageDriver } from '../../lib/drivers/types'
import { GET as readFile } from '../file/[id]/route'
import { GET as readImage } from '../image/[id]/[[...slug]]/route'
import { DELETE as deleteLibraryFile } from '../library/[id]/route'
import commands from '../../cli'
import recoverQuota from '../../workers/quota-recovery'
import { createAttachmentFromBuffer } from '../../lib/createFromBuffer'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ sub: 'user-test', tenantId: 'tenant-test', orgId: 'org-test', roles: [] }),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: mockResolve }),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (_key: string, fallback: string) => fallback }),
}))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({ emitCrudSideEffects: jest.fn() }))
jest.mock('../../lib/requestScope', () => ({ resolveAttachmentOrganizationId: async () => 'org-test' }))
jest.mock('../../lib/quota-recovery-queue', () => ({ scheduleAttachmentQuotaRecovery: jest.fn(async () => undefined) }))
jest.mock('../../lib/thumbnailCache', () => ({
  buildThumbnailCacheKey: jest.fn(() => null),
  readThumbnailCache: jest.fn(async () => null),
  writeThumbnailCache: jest.fn(async () => undefined),
}))
jest.mock('../../data/entities', () => ({ Attachment: class Attachment {}, AttachmentPartition: class AttachmentPartition {} }))

const attachment = {
  id: 'attachment-test', tenantId: 'tenant-test', organizationId: 'org-test',
  partitionCode: 'privateAttachments', storageDriver: 'consumer-proof', storagePath: 'provider/file',
  fileName: 'image.png', mimeType: 'image/png', fileSize: 0,
}
let mockPartition: Record<string, unknown> | null
let imageBytes: Buffer
const mockFlush = jest.fn(async () => undefined)
const mockRemove = jest.fn(() => ({ flush: mockFlush }))
const mockPersist = jest.fn(() => ({ flush: mockFlush }))
const lookupChain = {
  select: jest.fn(() => lookupChain), where: jest.fn(() => lookupChain),
  executeTakeFirst: jest.fn(async () => undefined),
}
const mockEm = {
  findOne: jest.fn(async (entity: { name?: string }) => entity.name === 'Attachment' ? attachment : mockPartition),
  find: jest.fn(async () => [attachment]),
  create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
  remove: mockRemove, persist: mockPersist, flush: mockFlush,
  getKysely: () => ({ selectFrom: () => lookupChain }),
  transactional: async (work: (manager: { persist: typeof mockPersist }) => Promise<void>) => work({ persist: mockPersist }),
}
const reservation = {
  id: 'reservation-test', status: 'storing', expiresAt: new Date(0), leaseToken: 'lease-test',
  tenantId: 'tenant-test', organizationId: 'org-test', partitionCode: 'privateAttachments',
  storageDriver: 'consumer-proof', storagePath: 'provider/file',
}
const quota = {
  getReservation: jest.fn(async () => reservation),
  claimExpired: jest.fn(async () => reservation),
  release: jest.fn(async () => undefined),
}
const driver: StorageDriver = {
  key: 'consumer-proof',
  store: jest.fn(async () => ({ storagePath: 'provider/new' })),
  read: jest.fn(async () => ({ buffer: imageBytes })),
  delete: jest.fn(async () => undefined),
  toLocalPath: jest.fn(async () => ({ filePath: '/unused', cleanup: async () => undefined })),
}
const construct = jest.fn(() => driver)
const validate = jest.fn(({ config }: { config: Readonly<Record<string, unknown>> }) => config.bucket === 'valid')
function mockResolve<T>(key: string): T {
  const values: Record<string, unknown> = {
    em: mockEm, dataEngine: null, attachmentQuotaService: quota,
    storageDriverFactory: new StorageDriverFactory(mockEm as unknown as EntityManager),
  }
  return values[key] as T
}
const context = { params: Promise.resolve({ id: attachment.id }) }
const previousPolicy = process.env.OM_ATTACHMENT_STORAGE_POLICY
let unregister: () => void

beforeAll(async () => {
  imageBytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ffffff' } }).png().toBuffer()
  registerExternalStorageDriver('consumer-proof', construct)
  unregister = registerStorageDriverValidator('consumer-proof', validate)
})
beforeEach(() => {
  jest.clearAllMocks()
  process.env.OM_ATTACHMENT_STORAGE_POLICY = 'strict'
  mockPartition = { code: 'privateAttachments', storageDriver: 'consumer-proof', configJson: { bucket: 'valid' }, isPublic: false }
})
afterEach(() => {
  if (previousPolicy === undefined) delete process.env.OM_ATTACHMENT_STORAGE_POLICY
  else process.env.OM_ATTACHMENT_STORAGE_POLICY = previousPolicy
})
afterAll(() => unregister())

const httpPaths = [
  ['file', () => readFile(new Request('http://x/api/attachments/file/attachment-test') as NextRequest, context)],
  ['image', () => readImage(new Request('http://x/api/attachments/image/attachment-test') as NextRequest, context)],
  ['library deletion', () => deleteLibraryFile(new Request('http://x/api/attachments/library/attachment-test', { method: 'DELETE' }) as NextRequest, context)],
] as const

describe.each(httpPaths)('%s storage configuration', (_path, request) => {
  it.each([
    ['missing', null, 'partition_missing'],
    ['null driver', { storageDriver: null, configJson: {} }, 'driver_missing'],
    ['unknown driver', { storageDriver: 'unknown', configJson: {} }, 'unknown_driver'],
    ['malformed config', { storageDriver: 'consumer-proof', configJson: 'secret-sentinel' }, 'invalid_config'],
    ['provider rejection', { storageDriver: 'consumer-proof', configJson: { bucket: 'secret-sentinel' } }, 'validator_rejected'],
  ])('returns typed redacted rejection for %s', async (_case, invalid, reason) => {
    mockPartition = invalid === null ? null : { code: 'privateAttachments', isPublic: false, ...invalid }
    const response = await request()
    expect(response.status).toBe(503)
    const body: unknown = await response.json()
    expect(body).toMatchObject({ code: 'ATTACHMENT_STORAGE_CONFIGURATION_INVALID', reason })
    expect(JSON.stringify(body)).not.toContain('secret-sentinel')
    expect(construct).not.toHaveBeenCalled()
    expect(driver.read).not.toHaveBeenCalled()
    expect(driver.delete).not.toHaveBeenCalled()
    expect(mockRemove).not.toHaveBeenCalled()
  })

  it('uses the valid provider with trusted operation scope', async () => {
    const response = await request()
    expect(response.status).toBe(200)
    expect(construct).toHaveBeenCalledTimes(1)
    expect(validate).toHaveBeenCalledWith(expect.objectContaining({ scope: { tenantId: 'tenant-test', organizationId: 'org-test' } }))
    expect(_path === 'library deletion' ? driver.delete : driver.read).toHaveBeenCalledWith('privateAttachments', 'provider/file')
  })
})

const job = { payload: { reservationId: reservation.id, tenantId: 'tenant-test', organizationId: 'org-test' } } as Parameters<typeof recoverQuota>[0]
const workerContext = { resolve: mockResolve } as Parameters<typeof recoverQuota>[1]

it('preserves quota reservation and typed rejection when recovery configuration is invalid', async () => {
  mockPartition = { storageDriver: 'unknown' }
  await expect(recoverQuota(job, workerContext)).rejects.toMatchObject({ code: 'ATTACHMENT_STORAGE_CONFIGURATION_INVALID', reason: 'unknown_driver' })
  expect(quota.release).not.toHaveBeenCalled()
  expect(driver.delete).not.toHaveBeenCalled()
  expect(construct).not.toHaveBeenCalled()
})

it('cleans up a valid provider and releases its recovered reservation', async () => {
  await recoverQuota(job, workerContext)
  expect(driver.delete).toHaveBeenCalledWith('privateAttachments', 'provider/file')
  expect(quota.release).toHaveBeenCalledWith(reservation.id, reservation.leaseToken)
})

it('propagates a typed CLI failure without deleting metadata or bytes', async () => {
  mockPartition = { storageDriver: null }
  await expect(commands[0].run(['--id', attachment.id])).rejects.toMatchObject({ reason: 'driver_missing' })
  expect(mockRemove).not.toHaveBeenCalled()
  expect(driver.delete).not.toHaveBeenCalled()
})

it('deletes through the registered provider from the CLI', async () => {
  const print = jest.spyOn(console, 'log').mockImplementation(() => undefined)
  try {
    await commands[0].run(['--id', attachment.id])
    expect(driver.delete).toHaveBeenCalledWith('privateAttachments', 'provider/file')
    expect(mockRemove).toHaveBeenCalledWith(attachment)
  } finally { print.mockRestore() }
})

it('uses strict policy in a helper that directly constructs a late factory', async () => {
  mockPartition = { code: 'privateAttachments', storageDriver: 'unknown' }
  await expect(createAttachmentFromBuffer({
    em: mockEm as unknown as EntityManager, tenantId: 'tenant-test', organizationId: 'org-test',
    entityId: 'example:todo', recordId: 'record-test', fileName: 'file.txt', mimeType: 'text/plain', buffer: Buffer.from('bytes'),
  })).rejects.toMatchObject({ reason: 'unknown_driver' })
  expect(driver.store).not.toHaveBeenCalled()
  expect(mockPersist).not.toHaveBeenCalled()
})

it('uses the valid registered provider from direct late construction', async () => {
  await createAttachmentFromBuffer({
    em: mockEm as unknown as EntityManager, tenantId: 'tenant-test', organizationId: 'org-test',
    entityId: 'example:todo', recordId: 'record-test', fileName: 'file.txt', mimeType: 'text/plain', buffer: Buffer.from('bytes'),
  })
  expect(driver.store).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-test', orgId: 'org-test' }))
  expect(mockPersist).toHaveBeenCalled()
})
