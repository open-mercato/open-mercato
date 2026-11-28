import type { AwilixContainer } from 'awilix'
import type { Attachment, AttachmentPartition } from '../../data/entities'
import { createAttachmentAccessContext } from '../access-runner'
import { registerAttachmentAccessResolvers } from '../access-registry'
import { requiresAttachmentAccessScan, scanAuthorizedAttachments } from '../access-query'

jest.mock('../../data/entities', () => ({ Attachment: class {}, AttachmentPartition: class {} }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ t: (key: string) => key }) }))
const auth = { sub: 'user', tenantId: 'tenant', orgId: 'org' }
const partition = { code: 'private', isPublic: false, accessResolverRequirements: [{ resolverId: 'documents.files', targetEntity: 'documents:document' }] } as AttachmentPartition
const container = { resolve: () => ({
  loadAcl: async () => ({ isSuperAdmin: false, organizations: null }), getEffectiveFeatures: async () => ['documents.view'],
}) } as unknown as AwilixContainer
const records = Array.from({ length: 213 }, (_, index) => ({
  id: String(index), entityId: 'documents:document', recordId: index % 2 ? 'hidden' : 'visible',
  tenantId: 'tenant', organizationId: 'org', partitionCode: 'private', fileName: 'file', mimeType: 'text/plain',
  storageMetadata: { tags: [index % 2 ? 'secret-tag' : 'visible-tag'] }, content: index % 2 ? 'secret OCR' : 'public OCR',
})) as Attachment[]
const loadBatch = jest.fn(async (offset: number, limit: number) => records.slice(offset, offset + limit))
const scan = (changes: Partial<Parameters<typeof scanAuthorizedAttachments>[0]> = {}) => scanAuthorizedAttachments({
  auth, context: createAttachmentAccessContext(container), partitions: [partition], loadBatch, offset: 50, limit: 20, collectTags: true, ...changes,
})

beforeEach(() => {
  jest.clearAllMocks()
  registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [{
    id: 'documents.files', targetPartition: '*', targetEntity: 'documents:document',
    resolve: async (input: { attachment: { recordId: string } }) => input.attachment.recordId === 'visible'
      ? { ok: true } : { ok: false, status: 404, reason: 'not_found' },
  }] }])
})
afterEach(() => { registerAttachmentAccessResolvers([]); jest.useRealTimers() })

it('filters before exact pagination, counts and tags across bounded database batches', async () => {
  const result = await scan()
  expect(result.total).toBe(107)
  expect(result.records.map((record) => record.id)).toEqual(Array.from({ length: 20 }, (_, index) => String(100 + index * 2)))
  expect(result.tags).toEqual(['visible-tag'])
  expect(loadBatch.mock.calls).toEqual([[0, 100], [100, 100], [200, 100]])
  expect(JSON.stringify(result)).not.toContain('secret')
})

it('does not retain off-page rows while collecting authorized facets', async () => {
  const result = await scan({ limit: 0 })
  expect(result.records).toEqual([])
  expect(result.tags).toEqual(['visible-tag'])
})

it('keeps malformed durable policies on the protected scan path even without active declarations', () => {
  registerAttachmentAccessResolvers([])
  expect(requiresAttachmentAccessScan([{ ...partition, accessResolverRequirements: {} } as AttachmentPartition])).toBe(true)
  expect(requiresAttachmentAccessScan([{ ...partition, accessResolverRequirements: null } as AttachmentPartition])).toBe(false)
})

it('returns no partial results when the whole scan budget expires during a database read', async () => {
  jest.useFakeTimers()
  const pending = scan({ loadBatch: () => new Promise(() => undefined), deadline: Date.now() + 50 })
  const assertion = expect(pending).rejects.toMatchObject({ status: 504 })
  await jest.advanceTimersByTimeAsync(51)
  await assertion
  expect(jest.getTimerCount()).toBe(0)
})

it('propagates callback timeouts instead of reporting a misleading zero total', async () => {
  jest.useFakeTimers()
  registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [{
    id: 'documents.files', targetPartition: '*', timeoutMs: 10, resolve: () => new Promise(() => undefined),
  }] }])
  const pending = scan()
  const assertion = expect(pending).rejects.toMatchObject({ status: 504 })
  await jest.advanceTimersByTimeAsync(11)
  await assertion
  expect(jest.getTimerCount()).toBe(0)
})
