import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { AttachmentAccessInput } from '@open-mercato/core/modules/attachments'
import { attachmentAccessResolvers, protectedAttachmentTargets } from '../data/attachment-access'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))
jest.mock('../data/entities', () => ({ SyncExcelUpload: class {} }))

const uploadId = '20000000-0000-4000-8000-000000000001'
const em = {}
const container = { resolve: () => em } as unknown as AwilixContainer
let uploadExists = true

function input(overrides: Partial<AttachmentAccessInput> = {}): AttachmentAccessInput {
  return {
    action: 'read',
    container,
    cache: new Map(),
    signal: new AbortController().signal,
    subject: {
      auth: { sub: 'user-1', tenantId: 'tenant', orgId: 'org' },
      tenantId: 'tenant',
      organizationId: 'org',
      isSuperAdmin: false,
      userFeatures: ['sync_excel.view'],
    },
    attachment: {
      id: 'attachment', entityId: 'sync_excel:upload', recordId: uploadId,
      partitionCode: 'privateAttachments', fileName: 'import.csv', mimeType: 'text/csv',
    },
    partition: { code: 'privateAttachments', isPublic: false },
    targets: [{ entityId: 'sync_excel:upload', recordId: uploadId, origin: 'primary' }],
    ...overrides,
  }
}

const resolve = (value: AttachmentAccessInput) => attachmentAccessResolvers[0].resolve(value)

beforeEach(() => {
  jest.clearAllMocks()
  uploadExists = true
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, _entity, raw) => {
    const where = raw as { id: string; tenantId: string; organizationId: string }
    expect(where).toMatchObject({ tenantId: 'tenant', organizationId: 'org' })
    return where.id === uploadId && uploadExists ? { id: uploadId } as never : null
  })
})

it('declares a single protected target for its own partition and entity', () => {
  expect(protectedAttachmentTargets).toEqual([{
    resolverId: 'sync_excel.upload-attachments',
    targetPartition: 'privateAttachments',
    targetEntity: 'sync_excel:upload',
  }])
})

it('allows a viewer with sync_excel.view to read an existing upload', async () => {
  expect(await resolve(input())).toEqual({ ok: true })
})

it('denies a caller missing sync_excel.view even when the upload exists', async () => {
  const value = input({ subject: { ...input().subject, userFeatures: [] } })
  expect(await resolve(value)).toMatchObject({ ok: false, status: 404, reason: 'sync_excel_upload_not_found' })
  expect(findOneWithDecryption).not.toHaveBeenCalled()
})

it('denies when the upload is missing, deleted, or in a different scope', async () => {
  uploadExists = false
  expect(await resolve(input())).toMatchObject({ ok: false, status: 404, reason: 'sync_excel_upload_not_found' })
})

it('denies a malformed owner record id before querying', async () => {
  const value = input({ targets: [{ entityId: 'sync_excel:upload', recordId: 'not-a-uuid', origin: 'primary' }] })
  expect(await resolve(value)).toEqual({ ok: false, status: 404, reason: 'sync_excel_upload_not_found' })
  expect(findOneWithDecryption).not.toHaveBeenCalled()
})

it('still requires an existing upload for a superadmin without the feature', async () => {
  uploadExists = false
  const value = input({ subject: { ...input().subject, isSuperAdmin: true, userFeatures: [] } })
  expect(await resolve(value)).toMatchObject({ ok: false, status: 404, reason: 'sync_excel_upload_not_found' })
})

it('memoizes the existence lookup within one request', async () => {
  const value = input()
  expect(await resolve(value)).toEqual({ ok: true })
  expect(await resolve(value)).toEqual({ ok: true })
  expect(findOneWithDecryption).toHaveBeenCalledTimes(1)
})
