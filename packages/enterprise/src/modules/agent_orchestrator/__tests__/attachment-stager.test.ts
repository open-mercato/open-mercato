import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { writeFile } from 'node:fs/promises'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import { registerAttachmentAccessResolvers } from '@open-mercato/core/modules/attachments/lib/access-registry'
import type { AttachmentAccessInput, AttachmentAccessDecision } from '@open-mercato/core/modules/attachments/lib/access-types'
import { OcrService } from '@open-mercato/core/modules/attachments/lib/ocrService'
import { stageAttachments } from '../lib/runtime/attachmentStager'

jest.mock('node:fs/promises', () => ({ writeFile: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))
jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {}, AttachmentPartition: class AttachmentPartition {},
}))
jest.mock('@open-mercato/core/modules/attachments/lib/ocrService', () => ({
  OcrService: jest.fn().mockImplementation(() => ({ available: true, processFile: jest.fn(async () => ({ content: 'OCR text' })) })),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string) => key }),
}))

const scope = { tenantId: 'tenant', organizationId: 'org' }
const attachmentId = '11111111-1111-4111-8111-111111111111'
const requirement = { resolverId: 'documents.files', targetEntity: 'documents:document' }

function harness() {
  const attachment = Object.assign(new Attachment(), {
    id: attachmentId, ...scope, entityId: 'documents:document', recordId: 'private-document',
    partitionCode: 'private', fileName: 'input.pdf', mimeType: 'application/pdf', storagePath: 'object', content: null,
  })
  const partition = Object.assign(new AttachmentPartition(), {
    code: 'private', isPublic: false, accessResolverRequirements: [requirement],
  })
  const rows = [attachment]
  const read = jest.fn(async () => ({ buffer: Buffer.from('private bytes') }))
  const factory = { resolveForPartition: jest.fn(async () => ({ read })) }
  const rbac = {
    userHasAllFeatures: jest.fn(async () => true),
    loadAcl: jest.fn(async () => ({ isSuperAdmin: false, organizations: ['org'] })),
    getEffectiveFeatures: jest.fn(async () => ['attachments.view', 'documents.view']),
  }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'rbacService') return rbac
      if (name === 'storageDriverFactory') return factory
      throw new Error(`[internal] unexpected service ${name}`)
    }),
  } as unknown as AwilixContainer
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity, where) => {
    if (entity === AttachmentPartition) return partition as never
    const filter = where as { id: string; tenantId: string; organizationId: string }
    return (rows.find((row) => row.id === filter.id && row.tenantId === filter.tenantId
      && row.organizationId === filter.organizationId) ?? null) as never
  })
  const resolve = jest.fn(async (_input: AttachmentAccessInput): Promise<AttachmentAccessDecision> => ({ ok: true }))
  const register = () => registerAttachmentAccessResolvers([{
    moduleId: 'documents', resolvers: [{ id: requirement.resolverId, targetPartition: '*', targetEntity: requirement.targetEntity, resolve }],
    protectedTargets: [{ ...requirement, targetPartition: '*' }],
  }])
  register()
  const args = {
    container, em: {} as EntityManager, userId: 'workflow-execution-principal', ...scope,
    inDir: '/sandbox/in', files: { attachments: [{ attachmentId, ocrText: true }] },
  }
  const expectNoFileEffects = () => {
    expect(factory.resolveForPartition).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    expect(OcrService).not.toHaveBeenCalled()
  }
  return { args, attachment, partition, rows, rbac, resolve, register, read, expectNoFileEffects }
}

beforeEach(() => { jest.clearAllMocks(); registerAttachmentAccessResolvers([]) })
afterEach(() => registerAttachmentAccessResolvers([]))

it('leaves an empty envelope independent of attachment permissions and identity', async () => {
  const { args, rbac, expectNoFileEffects } = harness()
  await expect(stageAttachments({ ...args, userId: undefined, files: { attachments: [] } })).resolves.toEqual([])
  expect(rbac.userHasAllFeatures).not.toHaveBeenCalled()
  expectNoFileEffects()
})

it.each([undefined, '', '   '])('rejects a missing execution principal (%s)', async (userId) => {
  const { args, expectNoFileEffects } = harness()
  await expect(stageAttachments({ ...args, userId })).rejects.toThrow('execution principal')
  expect(findOneWithDecryption).not.toHaveBeenCalled()
  expectNoFileEffects()
})

it('requires attachments.view before looking up any attachment', async () => {
  const { args, rbac, expectNoFileEffects } = harness()
  rbac.userHasAllFeatures.mockResolvedValue(false)
  await expect(stageAttachments(args)).rejects.toThrow('attachments.view')
  expect(rbac.userHasAllFeatures).toHaveBeenCalledWith(args.userId, ['attachments.view'], scope)
  expect(findOneWithDecryption).not.toHaveBeenCalled()
  expectNoFileEffects()
})

it('fails closed when feature authorization is unavailable', async () => {
  const { args, rbac, expectNoFileEffects } = harness()
  rbac.userHasAllFeatures.mockRejectedValue(new Error('[internal] RBAC unavailable'))
  await expect(stageAttachments(args)).rejects.toThrow('RBAC unavailable')
  expectNoFileEffects()
})

it('runs the real owner policy as the execution principal before reading and OCR', async () => {
  const { args, resolve, rbac, read } = harness()
  await expect(stageAttachments(args)).resolves.toEqual([{ fileName: 'input.pdf', hasSidecar: true }])
  expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
    action: 'read', subject: expect.objectContaining({ auth: expect.objectContaining({ sub: args.userId, tenantId: 'tenant', orgId: 'org' }) }),
  }))
  expect(rbac.loadAcl).toHaveBeenCalledWith(args.userId, scope)
  expect(resolve.mock.invocationCallOrder[0]).toBeLessThan(read.mock.invocationCallOrder[0])
  expect(writeFile).toHaveBeenNthCalledWith(1, '/sandbox/in/input.pdf', Buffer.from('private bytes'))
  expect(writeFile).toHaveBeenNthCalledWith(2, '/sandbox/in/input.pdf.txt', 'OCR text', 'utf8')
})

it.each([null, 'cached private OCR'])('denies a private owner before bytes, cached text or OCR (%s)', async (content) => {
  const { args, attachment, resolve, expectNoFileEffects } = harness()
  attachment.content = content
  resolve.mockResolvedValue({ ok: false, status: 403, reason: 'private' })
  await expect(stageAttachments(args)).rejects.toMatchObject({ status: 403 })
  expectNoFileEffects()
})

it('preflights the entire envelope so a denied second file stages nothing', async () => {
  const { args, attachment, rows, resolve, expectNoFileEffects } = harness()
  const secondId = '22222222-2222-4222-8222-222222222222'
  rows.push(Object.assign(new Attachment(), attachment, { id: secondId }))
  args.files.attachments.push({ attachmentId: secondId, ocrText: true })
  resolve.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, status: 404, reason: 'not_found' })
  await expect(stageAttachments(args)).rejects.toMatchObject({ status: 404 })
  expect(resolve).toHaveBeenCalledTimes(2)
  expectNoFileEffects()
})

it.each(['tenantId', 'organizationId'] as const)('does not load a foreign %s row', async (column) => {
  const { args, attachment, expectNoFileEffects } = harness()
  attachment[column] = 'foreign'
  await expect(stageAttachments(args)).rejects.toThrow('not found in this tenant/org')
  expectNoFileEffects()
})

it('fails closed when a partition requirement has no resolver', async () => {
  const { args, expectNoFileEffects } = harness()
  registerAttachmentAccessResolvers([])
  await expect(stageAttachments(args)).rejects.toMatchObject({ status: 403 })
  expectNoFileEffects()
})

it('enforces protected targets even when partition requirements are absent', async () => {
  const { args, partition, expectNoFileEffects } = harness()
  partition.accessResolverRequirements = []
  registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [], protectedTargets: [{ ...requirement, targetPartition: '*' }] }])
  await expect(stageAttachments(args)).rejects.toMatchObject({ status: 403 })
  expectNoFileEffects()
})

it('fails closed when the owner resolver throws', async () => {
  const { args, resolve, expectNoFileEffects } = harness()
  resolve.mockRejectedValue(new Error('[internal] owner service unavailable'))
  await expect(stageAttachments(args)).rejects.toMatchObject({ status: 403 })
  expectNoFileEffects()
})

it('fails closed when the partition is missing', async () => {
  const { args, expectNoFileEffects } = harness()
  jest.mocked(findOneWithDecryption).mockResolvedValueOnce({ id: attachmentId, ...scope, partitionCode: 'missing' } as Attachment).mockResolvedValueOnce(null)
  await expect(stageAttachments(args)).rejects.toMatchObject({ status: 404 })
  expectNoFileEffects()
})
