import type { NextRequest } from 'next/server'
import { LockMode } from '@mikro-orm/core'
import { registerAttachmentAccessResolvers } from '../../lib/access-registry'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { PATCH, DELETE as deleteLibrary } from '../library/[id]/route'
import { POST as transfer } from '../transfer/route'

const mockAuth = { sub: 'user', tenantId: 'tenant', orgId: 'org' }
const firstId = '10000000-0000-4000-8000-000000000001'
const secondId = '10000000-0000-4000-8000-000000000002'
const mockAfterSuccess = jest.fn(async () => undefined)
let mockModifiedPayload: Record<string, unknown> | undefined
let mockDeniedRecord: string | undefined
let mockRecordDestination: string | undefined
const mockGuard = jest.fn(async (input: { input: { resourceId?: string; mutationPayload?: Record<string, unknown> } }) => {
  if (input.input.resourceId && input.input.resourceId === mockDeniedRecord) return { ok: false, errorStatus: 409, errorBody: { error: 'guard_blocked' } }
  return { ok: true, modifiedPayload: input.input.resourceId && mockRecordDestination
    ? { ...input.input.mutationPayload, toRecordId: mockRecordDestination } : mockModifiedPayload, runAfterSuccess: mockAfterSuccess }
})
const mockDelete = jest.fn(async () => undefined)
const mockResolveDriver = jest.fn(async () => ({ delete: mockDelete }))
const mockSetCustomFields = jest.fn(async () => undefined)
const mockEmit = jest.fn(async () => undefined)
const mockPartition = { code: 'private', isPublic: false, accessResolverRequirements: [{ resolverId: 'documents.fixture', targetEntity: 'documents:document' }] }
const makeRecord = (id = firstId, recordId = 'editable') => ({
  id, entityId: 'documents:document', recordId, tenantId: 'tenant', organizationId: 'org', partitionCode: 'private',
  fileName: 'private.txt', mimeType: 'text/plain', storagePath: 'private.txt', storageMetadata: { assignments: [{ type: 'documents:document', id: recordId }] },
})
let mockRecords = [makeRecord()]
const mockTx = {
  flush: jest.fn(async () => undefined), remove: jest.fn(),
}
const mockEm = { transactional: jest.fn(async (callback: (tx: typeof mockTx) => Promise<unknown>) => callback(mockTx)) }
const mockContainer = { resolve: (key: string) => ({
  em: mockEm, storageDriverFactory: { resolveForPartition: mockResolveDriver },
  dataEngine: { flushOrmEntityChanges: jest.fn(async () => undefined) }, queryEngine: null,
  rbacService: { loadAcl: async () => ({ isSuperAdmin: false, organizations: null }), getEffectiveFeatures: async () => ['documents.edit'] },
})[key] }

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: async () => mockAuth }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => mockContainer }))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({ runRouteMutationGuards: (...args: unknown[]) => mockGuard(...args) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({ emitCrudSideEffects: (...args: unknown[]) => mockEmit(...args), setCustomFieldsIfAny: (...args: unknown[]) => mockSetCustomFields(...args) }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ t: (key: string) => key }) }))
jest.mock('../../data/entities', () => ({ Attachment: class Attachment {}, AttachmentPartition: class AttachmentPartition {} }))
jest.mock('../../lib/assignmentDetails', () => ({ resolveAssignmentEnrichments: async () => new Map(), applyAssignmentEnrichments: (value: unknown) => value }))

const request = (body: unknown, method = 'PATCH') => new Request('http://localhost/api/attachments/library/file', { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) as NextRequest
const params = { params: Promise.resolve({ id: firstId }) }

beforeEach(() => {
  jest.clearAllMocks(); mockModifiedPayload = undefined; mockDeniedRecord = undefined; mockRecordDestination = undefined; mockRecords = [makeRecord()]
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity, where) => entity.name === 'AttachmentPartition'
    ? mockPartition as never : mockRecords.find((record) => record.id === (where as { id: string }).id) as never)
  jest.mocked(findWithDecryption).mockImplementation(async () => mockRecords as never)
  registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [{
    id: 'documents.fixture', targetPartition: '*', targetEntity: 'documents:document',
    resolve: async (input: { targets: Array<{ recordId: string }> }) => input.targets.every((target) => target.recordId === 'editable' || target.recordId === 'destination')
      ? { ok: true } : { ok: false, status: 404, reason: 'not_found' },
  }] }])
})
afterEach(() => registerAttachmentAccessResolvers([]))

it('denies stripping a protected source assignment before custom fields, flushes, or events', async () => {
  mockRecords = [makeRecord(firstId, 'hidden')]
  const response = await PATCH(request({ assignments: [], customFields: { secret: 'changed' } }), params)
  expect(response.status).toBe(404)
  expect(mockRecords[0].storageMetadata.assignments[0].id).toBe('hidden')
  expect(mockTx.flush).not.toHaveBeenCalled()
  expect(mockSetCustomFields).not.toHaveBeenCalled()
  expect(mockEmit).not.toHaveBeenCalled()
  expect(mockAfterSuccess).not.toHaveBeenCalled()
})

it('checks final guard-modified destinations rather than trusting the original payload', async () => {
  mockModifiedPayload = { assignments: [{ type: 'documents:document', id: 'hidden' }] }
  const response = await PATCH(request({ assignments: [{ type: 'documents:document', id: 'destination' }] }), params)
  expect(response.status).toBe(404)
  expect(mockRecords[0].storageMetadata.assignments[0].id).toBe('editable')
  expect(mockTx.flush).not.toHaveBeenCalled()
})

it('reloads and locks the source, commits allowed metadata, then runs guard callbacks and events', async () => {
  const response = await PATCH(request({ assignments: [{ type: 'documents:document', id: 'destination' }], customFields: { note: 'allowed' } }), params)
  expect(response.status).toBe(200)
  expect(findOneWithDecryption).toHaveBeenCalledWith(mockTx, expect.anything(), expect.objectContaining({ id: firstId }), {
    refresh: true, lockMode: LockMode.PESSIMISTIC_WRITE,
  }, { tenantId: 'tenant', organizationId: 'org' })
  expect(mockRecords[0].storageMetadata.assignments[0].id).toBe('destination')
  expect(mockSetCustomFields).toHaveBeenCalledTimes(1)
  expect(mockAfterSuccess).toHaveBeenCalledTimes(1)
})

it('rejects a mixed bulk transfer without mutating even its allowed first row', async () => {
  mockRecords = [makeRecord(), makeRecord(secondId, 'hidden')]
  const response = await transfer(request({ entityId: 'documents:document', attachmentIds: [secondId, firstId], toRecordId: 'destination' }, 'POST'))
  expect(response.status).toBe(404)
  expect(mockRecords.map((record) => record.recordId)).toEqual(['editable', 'hidden'])
  expect(mockTx.flush).not.toHaveBeenCalled()
  expect(findWithDecryption).toHaveBeenCalledWith(mockTx, expect.anything(), expect.objectContaining({ id: { $in: [firstId, secondId] } }), {
    orderBy: { id: 'asc' }, refresh: true, lockMode: LockMode.PESSIMISTIC_WRITE,
  }, { tenantId: 'tenant', organizationId: 'org' })
})

it('denies deletion before resolving storage or removing the database row', async () => {
  mockRecords = [makeRecord(firstId, 'hidden')]
  const response = await deleteLibrary(new Request('http://localhost/api/attachments/library/file', { method: 'DELETE' }) as NextRequest, params)
  expect(response.status).toBe(404)
  expect(mockResolveDriver).not.toHaveBeenCalled()
  expect(mockTx.remove).not.toHaveBeenCalled()
  expect(mockDelete).not.toHaveBeenCalled()
})

it('resolves an authorized deletion driver before commit and deletes bytes only after commit', async () => {
  const response = await deleteLibrary(new Request('http://localhost/api/attachments/library/file', { method: 'DELETE' }) as NextRequest, params)
  expect(response.status).toBe(200)
  expect(mockResolveDriver.mock.invocationCallOrder[0]).toBeLessThan(mockTx.remove.mock.invocationCallOrder[0])
  expect(mockTx.flush.mock.invocationCallOrder[0]).toBeLessThan(mockDelete.mock.invocationCallOrder[0])
})

it('runs a per-record guard on every locked row and rolls back a rejection of only the second row', async () => {
  mockRecords = [makeRecord(), makeRecord(secondId)]
  mockDeniedRecord = secondId
  const response = await transfer(request({ entityId: 'documents:document', attachmentIds: [firstId, secondId], toRecordId: 'destination' }, 'POST'))
  expect(response.status).toBe(409)
  expect(mockGuard.mock.calls.map(([entry]) => entry.input.resourceId)).toEqual([undefined, firstId, secondId])
  expect(mockRecords.map((record) => record.recordId)).toEqual(['editable', 'editable'])
  expect(mockTx.flush).not.toHaveBeenCalled()
  expect(mockAfterSuccess).not.toHaveBeenCalled()
})

it('authorizes the destination modified by the per-record guard', async () => {
  mockRecordDestination = 'hidden'
  const response = await transfer(request({ entityId: 'documents:document', attachmentIds: [firstId], toRecordId: 'destination' }, 'POST'))
  expect(response.status).toBe(404)
  expect(mockRecords[0].recordId).toBe('editable')
  expect(mockTx.flush).not.toHaveBeenCalled()
})

it('runs afterSuccess for each committed record in an allowed bulk transfer', async () => {
  mockRecords = [makeRecord(), makeRecord(secondId)]
  const response = await transfer(request({ entityId: 'documents:document', attachmentIds: [firstId, secondId], toRecordId: 'destination' }, 'POST'))
  expect(response.status).toBe(200)
  expect(mockRecords.map((record) => record.recordId)).toEqual(['destination', 'destination'])
  expect(mockAfterSuccess).toHaveBeenCalledTimes(3)
  expect(mockTx.flush.mock.invocationCallOrder[0]).toBeLessThan(mockAfterSuccess.mock.invocationCallOrder[0])
})
