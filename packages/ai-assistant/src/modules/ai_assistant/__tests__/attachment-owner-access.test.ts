/**
 * Owner access policies (attachment access resolvers) on the AI paths that load
 * attachment rows directly: the `attachments.*` tools, the chat attachment bridge
 * and the pending-action recheck.
 */
const findWithDecryptionMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()
const evaluateAttachmentRowAccessMock = jest.fn()
const buildAttachmentAccessAuthMock = jest.fn((principal: Record<string, unknown>) => (
  principal.apiKeyId ? { sub: `api_key:${principal.apiKeyId}`, isApiKey: true } : principal.userId ? { sub: principal.userId } : null
))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class AttachmentStub {},
}))

jest.mock('@open-mercato/core/modules/attachments/lib/metadata', () => ({
  readAttachmentMetadata: () => ({ tags: [], assignments: [] }),
  mergeAttachmentMetadata: (raw: unknown, patch: Record<string, unknown>) => ({ ...(raw as object), ...patch }),
}))

jest.mock('@open-mercato/core/modules/attachments/lib/access-rows', () => ({
  evaluateAttachmentRowAccess: (...args: unknown[]) => evaluateAttachmentRowAccessMock(...args),
  buildAttachmentAccessAuth: (principal: Record<string, unknown>) => buildAttachmentAccessAuthMock(principal),
}))

import attachmentsAiTools from '../ai-tools/attachments-pack'
import { resolveAttachmentParts } from '../lib/attachment-parts'
import { checkAttachmentScope } from '../lib/pending-action-recheck'
import type { AiPendingAction } from '../data/entities'

const protectedRow = {
  id: 'protected', entityId: 'documents:document', recordId: 'doc-1', partitionCode: 'privateAttachments',
  tenantId: 'tenant-1', organizationId: 'org-1', fileName: 'secret.pdf', mimeType: 'text/plain', fileSize: 10,
  storagePath: 'x', storageDriver: 'local', content: 'secret text', storageMetadata: null,
}
const plainRow = { ...protectedRow, id: 'plain', entityId: 'customers:customer_person_profile', recordId: 'person-1', fileName: 'plain.pdf', content: 'plain text' }

function denyIds(...ids: string[]) {
  evaluateAttachmentRowAccessMock.mockImplementation(async ({ rows }: { rows: Array<{ id: string }> }) => ({
    allowed: rows.filter((row) => !ids.includes(row.id)),
    denied: rows.filter((row) => ids.includes(row.id)),
  }))
}

function denyIdsFor(action: string, ...ids: string[]) {
  evaluateAttachmentRowAccessMock.mockImplementation(async ({ rows, action: evaluated }: { rows: Array<{ id: string }>; action: string }) => {
    const deniedIds = evaluated === action ? ids : []
    return { allowed: rows.filter((row) => !deniedIds.includes(row.id)), denied: rows.filter((row) => deniedIds.includes(row.id)) }
  })
}

const container = { resolve: (name: string) => (name === 'em' ? { find: async () => [], persist: jest.fn(), flush: jest.fn() } : undefined) }

function tool(name: string) {
  const found = attachmentsAiTools.find((entry) => entry.name === name)
  if (!found) throw new Error(`tool ${name} missing`)
  return found
}

beforeEach(() => {
  jest.clearAllMocks()
  denyIds()
})

describe('attachments.* tools', () => {
  const ctx = { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'creator-1', apiKeyId: 'key-1', container, userFeatures: ['attachments.view'], isSuperAdmin: false }

  it('omits rows the owner policy denies from the record listing', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([protectedRow, plainRow])
    denyIds('protected')
    const result = await tool('attachments.list_record_attachments').handler({ entityType: 'documents:document', recordId: 'doc-1' }, ctx as never) as { items: Array<{ id: string }>; total: number }
    expect(result.items.map((item) => item.id)).toEqual(['plain'])
    expect(result.total).toBe(1)
    expect(evaluateAttachmentRowAccessMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'metadata' }))
  })

  it('evaluates key-authenticated calls as the key, not as its creator', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([plainRow])
    await tool('attachments.list_record_attachments').handler({ entityType: 'x', recordId: 'y' }, ctx as never)
    expect(buildAttachmentAccessAuthMock).toHaveBeenCalledWith(expect.objectContaining({ apiKeyId: 'key-1', userId: 'creator-1' }))
    expect(evaluateAttachmentRowAccessMock).toHaveBeenCalledWith(expect.objectContaining({ auth: { sub: 'api_key:key-1', isApiKey: true } }))
  })

  it('reports a denied attachment as not found, including its extracted text', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(protectedRow)
    denyIds('protected')
    const result = await tool('attachments.read_attachment').handler({ attachmentId: '00000000-0000-4000-8000-000000000001', includeExtractedText: true }, ctx as never)
    expect(result).toEqual({ found: false, attachmentId: '00000000-0000-4000-8000-000000000001' })
    expect(evaluateAttachmentRowAccessMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'read' }))
  })

  it('refuses a transfer when a visible row may not be reassigned, checking the destination owner', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([plainRow])
    denyIdsFor('reassign', 'plain')
    await expect(tool('attachments.transfer_record_attachments').handler({
      fromEntityType: 'customers:customer_person_profile', fromRecordId: 'person-1',
      toEntityType: 'customers:customer_person_profile', toRecordId: 'person-2',
    }, ctx as never)).rejects.toThrow('not allowed')
    expect(evaluateAttachmentRowAccessMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'reassign',
      destination: { entityId: 'customers:customer_person_profile', recordId: 'person-2', moveAssignments: true },
    }))
  })

  it('treats rows the caller may not see as absent instead of revealing them through a refusal', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([protectedRow])
    denyIds('protected')
    const result = await tool('attachments.transfer_record_attachments').handler({
      fromEntityType: 'documents:document', fromRecordId: 'doc-1',
      toEntityType: 'documents:document', toRecordId: 'doc-2',
    }, ctx as never)
    expect(result).toMatchObject({ transferred: 0 })
    expect(protectedRow.recordId).toBe('doc-1')
  })
})

describe('chat attachment bridge', () => {
  it('drops an attachment the owner policy denies before it reaches the model', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(protectedRow)
    denyIds('protected')
    const parts = await resolveAttachmentParts({
      attachmentIds: ['protected'],
      authContext: { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1', features: [], isSuperAdmin: false },
      container: container as never,
    })
    expect(parts).toEqual([])
    expect(evaluateAttachmentRowAccessMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'read' }))
  })

  it('evaluates all attachments once and keeps the requested order of the allowed ones', async () => {
    const rowsById: Record<string, typeof protectedRow> = {
      plain: plainRow, protected: protectedRow, plain2: { ...plainRow, id: 'plain2', fileName: 'plain2.pdf' },
    }
    findOneWithDecryptionMock.mockImplementation(async (_em: unknown, _entity: unknown, where: { id: string }) => rowsById[where.id] ?? null)
    denyIds('protected')
    const parts = await resolveAttachmentParts({
      attachmentIds: ['plain', 'protected', 'plain2', 'plain'],
      authContext: { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1', features: [], isSuperAdmin: false },
      container: container as never,
    })
    expect(parts.map((part) => part.attachmentId)).toEqual(['plain', 'plain2', 'plain'])
    expect(evaluateAttachmentRowAccessMock).toHaveBeenCalledTimes(1)
  })

  it('drops every attachment when the owner access evaluation fails', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(plainRow)
    evaluateAttachmentRowAccessMock.mockRejectedValueOnce(new Error('partition lookup failed'))
    const parts = await resolveAttachmentParts({
      attachmentIds: ['plain'],
      authContext: { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1', features: [], isSuperAdmin: false },
      container: container as never,
    })
    expect(parts).toEqual([])
  })
})

describe('pending-action recheck', () => {
  const action = { attachmentIds: ['protected'] } as unknown as AiPendingAction
  const recheckCtx = {
    tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1', userFeatures: [], isSuperAdmin: false,
    container: container as never, em: { find: async () => [] } as never,
  }

  it('rejects a pending action that references an attachment the owner policy denies', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([protectedRow])
    denyIds('protected')
    await expect(checkAttachmentScope(action, recheckCtx)).resolves.toMatchObject({ ok: false, status: 403 })
  })

  it('evaluates without a principal when no container is available, so only protected rows are denied', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([protectedRow])
    denyIds('protected')
    await expect(checkAttachmentScope(action, { ...recheckCtx, container: undefined })).resolves.toMatchObject({ ok: false, status: 403 })
    expect(evaluateAttachmentRowAccessMock).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined, container: undefined }))
  })

  it('passes when the owner policy allows every attachment', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([protectedRow])
    await expect(checkAttachmentScope(action, recheckCtx)).resolves.toEqual({ ok: true })
  })
})
