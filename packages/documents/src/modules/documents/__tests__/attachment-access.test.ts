import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { AttachmentAccessInput } from '@open-mercato/core/modules/attachments'
import { attachmentAccessResolvers } from '../data/attachment-access'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
jest.mock('../data/entities', () => ({ Document: class {}, DocumentShare: class {} }))

const userId = '10000000-0000-4000-8000-000000000001'
const ownerId = '10000000-0000-4000-8000-000000000002'
const documentId = '20000000-0000-4000-8000-000000000001'
const otherId = '20000000-0000-4000-8000-000000000002'
const keyId = '30000000-0000-4000-8000-000000000001'
const principal = {
  principalExists: jest.fn(), resolveLabels: jest.fn(), listSuperAdminUserIds: jest.fn(),
  resolveActiveUserRoleIds: jest.fn(async () => ['active-role']),
  filterActiveRoleIds: jest.fn(async () => ['key-role']),
}
const keyPrincipal = { resolveAssignedRoleIds: jest.fn(async () => ['key-role']) }
const em = {}
const container = { resolve: (name: string) => name === 'em' ? em : name === 'authPrincipalService' ? principal : keyPrincipal } as unknown as AwilixContainer
let archived = false
let owner = ownerId
let shared = true

function input(overrides: Partial<AttachmentAccessInput> = {}): AttachmentAccessInput {
  return {
    action: 'read', container, cache: new Map(), signal: new AbortController().signal,
    subject: {
      auth: { sub: userId, tenantId: 'tenant', orgId: 'org' },
      tenantId: 'tenant', organizationId: 'org', isSuperAdmin: false,
      userFeatures: ['documents.view', 'documents.edit'],
    },
    attachment: { id: 'attachment', entityId: 'documents:document', recordId: documentId, partitionCode: 'private', fileName: 'private.txt', mimeType: 'text/plain' },
    partition: { code: 'private', isPublic: false },
    targets: [{ entityId: 'documents:document', recordId: documentId, origin: 'primary' }],
    ...overrides,
  }
}
const resolve = (value: AttachmentAccessInput) => attachmentAccessResolvers[0].resolve(value)

beforeEach(() => {
  jest.clearAllMocks(); archived = false; owner = ownerId; shared = true
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, _entity, raw) => {
    const where = raw as { id: string; tenantId: string; organizationId: string; deletedAt: unknown }
    expect(where).toMatchObject({ tenantId: 'tenant', organizationId: 'org', deletedAt: null })
    return where.id === documentId ? { id: documentId, ownerUserId: owner, archivedAt: archived ? new Date() : null } as never : null
  })
  jest.mocked(findWithDecryption).mockImplementation(async () => shared ? [{ permission: 'viewer' }] as never : [])
})

it('uses actual sharing permission for reads but requires the attachment edit capability for mutations', async () => {
  expect(await resolve(input())).toEqual({ ok: true })
  expect(await resolve(input({ action: 'delete' }))).toMatchObject({ ok: false, status: 404 })
  expect(await resolve(input({ action: 'create' }))).toMatchObject({ ok: false, status: 404 })
  jest.mocked(findWithDecryption).mockResolvedValue([{ permission: 'editor' }] as never)
  expect(await resolve(input({ action: 'delete' }))).toEqual({ ok: true })
  expect(await resolve(input({ action: 'reassign' }))).toEqual({ ok: true })
  expect(await resolve(input({ action: 'create' }))).toEqual({ ok: true })
  archived = true
  expect(await resolve(input({ action: 'delete' }))).toMatchObject({ ok: false })
  expect(await resolve(input({ action: 'create' }))).toMatchObject({ ok: false })
})

it('denies unshared callers including attachments managers and observes revocation in the next request', async () => {
  expect(await resolve(input())).toEqual({ ok: true })
  shared = false
  const value = input({ subject: { ...input().subject, userFeatures: ['documents.view', 'attachments.manage'] } })
  expect(await resolve(value)).toMatchObject({ ok: false, status: 404 })
})

it('retains owner and Documents manager permissions only with the required active features', async () => {
  shared = false; owner = userId
  expect(await resolve(input())).toEqual({ ok: true })
  const missingFeature = input({ subject: { ...input().subject, userFeatures: ['documents.manage'] } })
  expect(await resolve(missingFeature)).toMatchObject({ ok: false })
  owner = ownerId
  const manager = input({ subject: { ...input().subject, userFeatures: ['documents.manage', 'documents.view', 'documents.edit'] } })
  expect(await resolve(manager)).toEqual({ ok: true })
  expect(await resolve({ ...manager, action: 'delete' })).toEqual({ ok: true })
})

it('allows bytes through one visible document but requires every owner for metadata and edits', async () => {
  const value = input({ targets: [
    { entityId: 'documents:document', recordId: documentId, origin: 'primary' },
    { entityId: 'documents:document', recordId: otherId, origin: 'assignment' },
  ] })
  expect(await resolve(value)).toEqual({ ok: true })
  for (const action of ['metadata', 'export', 'delete', 'reassign', 'create'] as const) {
    expect(await resolve({ ...value, action })).toMatchObject({ ok: false, status: 404 })
  }
})

it('denies malformed or absent owner records before a manager override', async () => {
  const value = input({ targets: [{ entityId: 'documents:document', recordId: otherId, origin: 'primary' }],
    subject: { ...input().subject, isSuperAdmin: true, userFeatures: ['documents.manage', 'documents.view'] },
  })
  expect(await resolve(value)).toMatchObject({ ok: false })
  expect(await resolve(input({ targets: [{ entityId: 'documents:document', recordId: 'not-a-uuid', origin: 'primary' }] }))).toMatchObject({ ok: false })
})

it('projects current roles by ACL subject and never grants a key its backing user roles', async () => {
  const value = input({ subject: { ...input().subject, auth: { sub: `api_key:${keyId}`, keyId, isApiKey: true, userId, tenantId: 'tenant', orgId: 'org', roleIds: ['stale-role'] } } })
  expect(await resolve(value)).toEqual({ ok: true })
  expect(keyPrincipal.resolveAssignedRoleIds).toHaveBeenCalledWith(keyId, { tenantId: 'tenant', organizationId: 'org' })
  expect(principal.resolveActiveUserRoleIds).not.toHaveBeenCalled()
  expect(findWithDecryption).toHaveBeenCalledWith(em, expect.anything(), expect.objectContaining({
    $or: [{ principalType: 'user', principalId: userId }, { principalType: 'role', principalId: { $in: ['key-role'] } }],
  }), undefined, { tenantId: 'tenant', organizationId: 'org' })
})

it('memoizes scoped owner policy within one request but recomputes the action decision', async () => {
  const value = input()
  expect(await resolve(value)).toEqual({ ok: true })
  expect(await resolve({ ...value, action: 'delete' })).toMatchObject({ ok: false })
  expect(principal.resolveActiveUserRoleIds).toHaveBeenCalledTimes(1)
  expect(findWithDecryption).toHaveBeenCalledTimes(1)
})

it('evaluates multi-target owners in sorted document-id order regardless of caller-provided target order', async () => {
  // Request order puts `otherId` first; the resolver must still evaluate
  // (and, at the commit boundary, lock) by sorted document id so two
  // callers with a reversed primary/assignment pair always take the same
  // lock order and cannot deadlock against each other (#8975 re-review).
  const callOrder: string[] = []
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, _entity, raw) => {
    const where = raw as { id: string }
    callOrder.push(where.id)
    return { id: where.id, ownerUserId: ownerId, archivedAt: null } as never
  })
  const reversed = input({ targets: [
    { entityId: 'documents:document', recordId: otherId, origin: 'primary' },
    { entityId: 'documents:document', recordId: documentId, origin: 'assignment' },
  ] })
  expect(await resolve(reversed)).toEqual({ ok: true })
  // Each document is read twice (`loadScopedDocument`, then `resolvePermission`)
  // before the loop moves to the next one — so all of the smaller id's calls
  // precede all of the larger id's calls, regardless of request order.
  expect(callOrder).toEqual([documentId, documentId, otherId, otherId])
})

it.each([
  { sub: `api_key:${keyId}`, isApiKey: true },
  { sub: `api_key:${otherId}`, keyId, isApiKey: true },
  { sub: `api_key:${keyId}`, keyId, isApiKey: true, userId: 'malformed' },
  { sub: 'malformed' },
])('returns a normal denial for an invalid actor projection: %j', async (auth) => {
  const value = input({ subject: { ...input().subject, auth } })
  await expect(resolve(value)).resolves.toEqual({ ok: false, status: 404, reason: 'document_not_found' })
  expect(findOneWithDecryption).not.toHaveBeenCalled()
  expect(findWithDecryption).not.toHaveBeenCalled()
  expect(principal.resolveActiveUserRoleIds).not.toHaveBeenCalled()
  expect(keyPrincipal.resolveAssignedRoleIds).not.toHaveBeenCalled()
})
