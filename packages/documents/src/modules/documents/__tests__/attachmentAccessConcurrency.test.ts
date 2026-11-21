import { LockMode } from '@mikro-orm/core'
import type { AttachmentAccessInput } from '@open-mercato/core/modules/attachments'
import { Document, DocumentShare } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const OWNER_ID = '33333333-3333-4333-8333-333333333333'
const EDITOR_ID = '44444444-4444-4444-8444-444444444444'
const DOCUMENT_ID = '55555555-5555-4555-8555-555555555555'
const SHARE_ID = '66666666-6666-4666-8666-666666666666'
const ATTACHMENT_ID = '77777777-7777-4777-8777-777777777777'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

import { lockDocumentAggregateRoot } from '../commands/aggregate'
import { attachmentAccessResolvers } from '../data/attachment-access'

/**
 * Models Postgres' `SELECT ... FOR UPDATE` on the Document row: only one
 * caller holds it at a time, and a second caller queues until the holder
 * calls `release()` (its transaction commits or rolls back). This is the
 * same mutex shape `watchCommandAtomic.test.ts` uses to test the identical
 * aggregate-lock protocol on a different command.
 */
function createDocumentRowLock() {
  const waiters: Array<() => void> = []
  let held = false
  return {
    async acquire(): Promise<void> {
      if (!held) {
        held = true
        return
      }
      await new Promise<void>((resolve) => { waiters.push(resolve) })
    },
    release(): void {
      const next = waiters.shift()
      if (next) next()
      else held = false
    },
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('attachment upload commit-boundary recheck vs. concurrent Documents mutations (#8975)', () => {
  let lock: ReturnType<typeof createDocumentRowLock>
  let documentRow: Document
  let shareRow: DocumentShare

  beforeEach(() => {
    jest.clearAllMocks()
    lock = createDocumentRowLock()
    documentRow = Object.assign(new Document(), {
      id: DOCUMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      ownerUserId: OWNER_ID,
      archivedAt: null,
      deletedAt: null,
    })
    shareRow = Object.assign(new DocumentShare(), {
      id: SHARE_ID,
      documentId: DOCUMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      principalType: 'user',
      principalId: EDITOR_ID,
      permission: 'editor',
      deletedAt: null,
    })

    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, Entity: unknown, _where: unknown, options?: { lockMode?: LockMode }) => {
      if (Entity === Document) {
        if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) await lock.acquire()
        return documentRow.deletedAt ? null : documentRow
      }
      return null
    })
    mockFindWithDecryption.mockImplementation(async (_em: unknown, Entity: unknown) => {
      if (Entity === DocumentShare) return shareRow.deletedAt ? [] : [shareRow]
      return []
    })
  })

  const scope = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }

  function buildResolverInput(em: unknown, commitBoundary: boolean): AttachmentAccessInput {
    return Object.freeze({
      action: 'create',
      subject: Object.freeze({
        auth: Object.freeze({
          sub: EDITOR_ID, userId: EDITOR_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID,
          isApiKey: false, isSuperAdmin: false,
        }),
        userFeatures: Object.freeze(['documents.view', 'documents.edit']),
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        isSuperAdmin: false,
      }),
      attachment: Object.freeze({
        id: ATTACHMENT_ID, entityId: 'documents:document', recordId: DOCUMENT_ID,
        partitionCode: 'default', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID,
        fileName: 'contract.pdf', mimeType: 'application/pdf',
      }),
      partition: Object.freeze({ code: 'default', isPublic: false, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }),
      targets: Object.freeze([{ entityId: 'documents:document', recordId: DOCUMENT_ID, origin: 'primary' as const }]),
      container: { resolve: (name: string) => { throw new Error(`Unexpected dependency: ${name}`) } },
      cache: new Map(),
      signal: new AbortController().signal,
      em: em as AttachmentAccessInput['em'],
      commitBoundary,
    }) as AttachmentAccessInput
  }

  const resolver = attachmentAccessResolvers[0]

  // Contender A: the upload route's commit-boundary recheck. The lock it
  // takes (via the real `attachmentAccessResolvers` resolver, fixed by
  // #8975, not a fixture) is only released when the surrounding attachment
  // transaction commits — modeled here by `releaseSignal`.
  async function runUploadCommitBoundaryCheck(em: unknown, releaseSignal: Promise<void> = Promise.resolve()) {
    const decision = await resolver.resolve(buildResolverInput(em, true))
    await releaseSignal
    lock.release()
    return decision
  }

  // Contender B: a concurrent `documents.share.delete` revoke. It locks the
  // Document row first too (the same protocol `loadLockedDocument` in
  // `commands/shares.ts` uses), then mutates the share — modeling the real
  // command's lock-then-mutate-then-commit shape via the shared exported
  // `lockDocumentAggregateRoot` helper.
  async function runConcurrentShareRevoke(em: unknown, releaseSignal: Promise<void> = Promise.resolve()) {
    await lockDocumentAggregateRoot(em as never, DOCUMENT_ID, scope)
    shareRow.deletedAt = new Date().toISOString()
    await releaseSignal
    lock.release()
  }

  it('blocks the commit-boundary recheck until a concurrent revoke commits, then denies on the now-revoked share', async () => {
    let releaseRevoke: () => void
    const revokeReleaseSignal = new Promise<void>((resolve) => { releaseRevoke = resolve })
    const revokePromise = runConcurrentShareRevoke('tx-revoke', revokeReleaseSignal)
    await delay(5) // let the revoke acquire the lock and soft-delete the share first

    let uploadSettled = false
    const uploadPromise = runUploadCommitBoundaryCheck('tx-upload').then((decision) => {
      uploadSettled = true
      return decision
    })
    await delay(5)
    expect(uploadSettled).toBe(false) // queued behind the still-open revoke transaction

    releaseRevoke!() // the revoke "commits"
    await revokePromise

    const decision = await uploadPromise
    expect(uploadSettled).toBe(true)
    expect(decision).toEqual({ ok: false, status: 404, reason: 'document_not_found' })
  })

  it('lets the commit-boundary recheck finish and commit first, serializing a queued revoke behind it', async () => {
    let releaseUpload: () => void
    const uploadReleaseSignal = new Promise<void>((resolve) => { releaseUpload = resolve })
    let uploadSettled = false
    const uploadPromise = runUploadCommitBoundaryCheck('tx-upload', uploadReleaseSignal).then((decision) => {
      uploadSettled = true
      return decision
    })
    await delay(5) // let the upload acquire the lock and obtain its decision first

    let revokeSettled = false
    const revokePromise = runConcurrentShareRevoke('tx-revoke').then(() => { revokeSettled = true })
    await delay(5)
    expect(revokeSettled).toBe(false) // queued behind the still-open upload transaction
    expect(shareRow.deletedAt).toBeNull() // not yet applied

    releaseUpload!() // the upload "commits"
    const decision = await uploadPromise
    expect(uploadSettled).toBe(true)
    expect(decision).toEqual({ ok: true })

    await revokePromise
    expect(revokeSettled).toBe(true)
    expect(shareRow.deletedAt).not.toBeNull() // the revoke only lands after the upload committed
  })
})
