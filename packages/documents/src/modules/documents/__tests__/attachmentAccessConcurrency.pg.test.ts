/**
 * Real-PostgreSQL counterpart to `attachmentAccessConcurrency.test.ts` (#8975
 * review). The unit test proves the resolver's lock *selection* — it is
 * correct about calling `lockDocumentAggregateRoot` when `commitBoundary` is
 * set — but it mocks `findOneWithDecryption`/`findWithDecryption` and
 * substitutes a JavaScript mutex for PostgreSQL's row lock, so it cannot show
 * that the generic upload's real transaction actually holds a `SELECT ...
 * FOR UPDATE` lock on the `documents` row until commit, or that a competing
 * transaction genuinely blocks on it rather than racing a plain read.
 *
 * This suite runs the REAL `attachmentAccessResolvers[0].resolve` and the
 * REAL `lockDocumentAggregateRoot` against a real Postgres, each contender in
 * its own `em.transactional` block on its own pooled connection, so the lock
 * contention is PostgreSQL's — not a fixture.
 *
 * Runs in the CI real-Postgres lane (`yarn workspace @open-mercato/documents
 * test:pg-integration`, OM_PG_INTEGRATION=1), which starts a disposable
 * container. Alternatively point OM_DOCUMENTS_PG_URL at a throwaway database
 * — the suite creates its own tables via `orm.schema.refresh()`, never a
 * development or shared one.
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import type { AttachmentAccessInput, AttachmentAccessDecision } from '@open-mercato/core/modules/attachments'
import { Document, DocumentFolder, DocumentShare } from '../data/entities'
import { lockDocumentAggregateRoot } from '../commands/aggregate'
import { attachmentAccessResolvers } from '../data/attachment-access'
import { acquireDocumentsPgDatabase, runsAgainstPostgres, type DocumentsPgDatabase } from './documentsPgDatabase'

const maybe = runsAgainstPostgres ? describe : describe.skip

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const OWNER_ID = '33333333-3333-4333-8333-333333333333'
const EDITOR_ID = '44444444-4444-4444-8444-444444444444'

const WAITER_POLL_MS = 15
const WAITER_TIMEOUT_MS = 5_000

type Deferred = { promise: Promise<void>; resolve: () => void }

function deferred(): Deferred {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

maybe('attachment upload commit-boundary recheck vs. concurrent Documents mutations against PostgreSQL (#8975)', () => {
  jest.setTimeout(120_000)
  let orm: MikroORM
  let database: DocumentsPgDatabase | undefined
  let documentId: string
  let shareId: string
  let documentId2: string
  let shareId2: string

  const scope = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }
  const resolver = attachmentAccessResolvers[0]

  beforeAll(async () => {
    database = await acquireDocumentsPgDatabase()
    orm = await MikroORM.init({
      clientUrl: database.url,
      entities: [Document, DocumentFolder, DocumentShare],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
    })
    await orm.schema.refresh()
  }, 120_000)

  afterAll(async () => {
    await orm?.close(true)
    await database?.release()
  })

  beforeEach(async () => {
    documentId = randomUUID()
    shareId = randomUUID()
    documentId2 = randomUUID()
    shareId2 = randomUUID()
    const em = orm.em.fork()
    em.create(Document, {
      id: documentId,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      title: 'Contract',
      ownerUserId: OWNER_ID,
      createdByUserId: OWNER_ID,
    })
    em.create(DocumentShare, {
      id: shareId,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      documentId,
      principalType: 'user',
      principalId: EDITOR_ID,
      permission: 'editor',
      createdByUserId: OWNER_ID,
    })
    em.create(Document, {
      id: documentId2,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      title: 'Invoice',
      ownerUserId: OWNER_ID,
      createdByUserId: OWNER_ID,
    })
    em.create(DocumentShare, {
      id: shareId2,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      documentId: documentId2,
      principalType: 'user',
      principalId: EDITOR_ID,
      permission: 'editor',
      createdByUserId: OWNER_ID,
    })
    await em.flush()
  })

  function buildResolverInput(em: EntityManager, commitBoundary: boolean): AttachmentAccessInput {
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
        id: randomUUID(), entityId: 'documents:document', recordId: documentId,
        partitionCode: 'default', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID,
        fileName: 'contract.pdf', mimeType: 'application/pdf',
      }),
      partition: Object.freeze({ code: 'default', isPublic: false, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }),
      targets: Object.freeze([{ entityId: 'documents:document', recordId: documentId, origin: 'primary' as const }]),
      container: { resolve: (name: string) => { throw new Error(`Unexpected dependency: ${name}`) } },
      cache: new Map(),
      signal: new AbortController().signal,
      em,
      commitBoundary,
    }) as AttachmentAccessInput
  }

  // Contender A: the upload route's real commit-boundary recheck, run inside
  // a real transaction. The `SELECT ... FOR UPDATE` lock the resolver takes
  // via `lockDocumentAggregateRoot` is only released when this transaction
  // commits or rolls back — held open here until `releaseSignal` resolves,
  // mirroring the surrounding `em.transactional` block in `route.ts`.
  async function runUploadCommitBoundaryCheck(
    releaseSignal: Promise<void> = Promise.resolve(),
  ): Promise<AttachmentAccessDecision> {
    const em = orm.em.fork()
    let decision!: AttachmentAccessDecision
    await em.transactional(async (tx) => {
      decision = await resolver.resolve(buildResolverInput(tx, true))
      await releaseSignal
    })
    return decision
  }

  // Contender B: a concurrent `documents.share.delete` revoke, using the real
  // exported `lockDocumentAggregateRoot` the shares command takes before
  // mutating, inside its own real transaction.
  async function runConcurrentShareRevoke(releaseSignal: Promise<void> = Promise.resolve()): Promise<void> {
    const em = orm.em.fork()
    await em.transactional(async (tx) => {
      await lockDocumentAggregateRoot(tx, documentId, scope)
      await tx.nativeUpdate(DocumentShare, { id: shareId }, { deletedAt: new Date() })
      await releaseSignal
    })
  }

  async function isShareRevoked(): Promise<boolean> {
    const share = await orm.em.fork().findOneOrFail(DocumentShare, { id: shareId })
    return share.deletedAt != null
  }

  // Two-target variant of `buildResolverInput`: a primary owner plus a
  // secondary assignment, both `documents:document`, in caller-supplied
  // order — used to prove the resolver locks by document id, not by the
  // order targets arrive in (#8975 re-review).
  function buildMultiTargetResolverInput(
    em: EntityManager,
    primaryRecordId: string,
    assignmentRecordId: string,
  ): AttachmentAccessInput {
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
        id: randomUUID(), entityId: 'documents:document', recordId: primaryRecordId,
        partitionCode: 'default', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID,
        fileName: 'contract.pdf', mimeType: 'application/pdf',
      }),
      partition: Object.freeze({ code: 'default', isPublic: false, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }),
      targets: Object.freeze([
        { entityId: 'documents:document', recordId: primaryRecordId, origin: 'primary' as const },
        { entityId: 'documents:document', recordId: assignmentRecordId, origin: 'assignment' as const },
      ]),
      container: { resolve: (name: string) => { throw new Error(`Unexpected dependency: ${name}`) } },
      cache: new Map(),
      signal: new AbortController().signal,
      em,
      commitBoundary: true,
    }) as AttachmentAccessInput
  }

  // Runs the commit-boundary recheck for an upload whose primary/assignment
  // pair is given in caller order — mirroring the route's real transaction
  // boundary (resolve, then hold the lock(s) open until `releaseSignal`).
  async function runMultiTargetUpload(
    primaryRecordId: string,
    assignmentRecordId: string,
    releaseSignal: Promise<void> = Promise.resolve(),
  ): Promise<AttachmentAccessDecision> {
    const em = orm.em.fork()
    let decision!: AttachmentAccessDecision
    await em.transactional(async (tx) => {
      decision = await resolver.resolve(buildMultiTargetResolverInput(tx, primaryRecordId, assignmentRecordId))
      await releaseSignal
    })
    return decision
  }

  async function waitForCondition(query: string, count: number, timeoutMs = WAITER_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const rows = await orm.em.execute<Array<{ n: number }>>(query)
      if (Number(rows[0]?.n ?? 0) >= count) return
      await new Promise((resolve) => setTimeout(resolve, WAITER_POLL_MS))
    }
    throw new Error(`[internal] Timed out waiting for condition to reach count ${count}: ${query}`)
  }

  // Acquisition barrier: proves a contender's transaction genuinely holds an
  // open Postgres transaction (idle between statements), not merely that
  // "enough time" has passed.
  function waitForIdleInTransaction(count: number): Promise<void> {
    return waitForCondition(
      `select count(*)::int as n from pg_stat_activity where datname = current_database() and state = 'idle in transaction'`,
      count,
    )
  }

  // Acquisition barrier: proves a contender's transaction is genuinely
  // blocked on Postgres' own lock manager, not racing a plain read.
  function waitForLockWaiters(count: number): Promise<void> {
    return waitForCondition(
      `select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
      count,
    )
  }

  it('blocks the commit-boundary recheck on Postgres row lock until a concurrent revoke commits, then denies on the now-revoked share', async () => {
    const revoke = deferred()
    let revokePromise: Promise<void> | undefined
    let uploadPromise: Promise<AttachmentAccessDecision> | undefined
    try {
      revokePromise = runConcurrentShareRevoke(revoke.promise)
      await waitForIdleInTransaction(1) // the revoke holds the row lock, soft-deleted share still uncommitted

      uploadPromise = runUploadCommitBoundaryCheck()
      await waitForLockWaiters(1) // genuinely blocked on Postgres' row lock, not a JS mutex

      revoke.resolve() // the revoke transaction commits, releasing the row lock
      await revokePromise

      const decision = await uploadPromise
      expect(decision).toEqual({ ok: false, status: 404, reason: 'document_not_found' })
      expect(await isShareRevoked()).toBe(true)
    } finally {
      revoke.resolve()
      await Promise.allSettled([revokePromise, uploadPromise])
    }
  })

  it('lets the commit-boundary recheck finish and commit first on Postgres, serializing a queued revoke behind it', async () => {
    const upload = deferred()
    let uploadPromise: Promise<AttachmentAccessDecision> | undefined
    let revokePromise: Promise<void> | undefined
    try {
      uploadPromise = runUploadCommitBoundaryCheck(upload.promise)
      await waitForIdleInTransaction(1) // the upload holds the row lock, decision still uncommitted

      let revokeSettled = false
      revokePromise = runConcurrentShareRevoke().then(() => { revokeSettled = true })
      await waitForLockWaiters(1) // queued behind the still-open upload transaction

      expect(revokeSettled).toBe(false)
      expect(await isShareRevoked()).toBe(false)

      upload.resolve() // the upload transaction commits, releasing the row lock
      const decision = await uploadPromise
      expect(decision).toEqual({ ok: true })

      await revokePromise
      expect(revokeSettled).toBe(true)
      expect(await isShareRevoked()).toBe(true) // the revoke only lands after the upload committed
    } finally {
      upload.resolve()
      await Promise.allSettled([uploadPromise, revokePromise])
    }
  })

  it('acquires locks for a reversed primary/assignment pair in a deterministic order and never deadlocks on real Postgres', async () => {
    // Before the fix, the resolver locked targets in request order —
    // `collectAttachmentAccessTargets` always puts the primary owner first —
    // so an upload with primary/assignment (documentId, documentId2) racing
    // one with the pair reversed could each hold their first document while
    // waiting for the other's lock: a genuine Postgres deadlock, not a slow
    // path. Running several reversed pairs concurrently against real
    // Postgres exercises that race directly; a reintroduced request-order
    // lock would surface here as a rejected promise (deadlock_detected) or a
    // hang, not just a wrong decision.
    const attempts = await Promise.all([
      runMultiTargetUpload(documentId, documentId2),
      runMultiTargetUpload(documentId2, documentId),
      runMultiTargetUpload(documentId, documentId2),
      runMultiTargetUpload(documentId2, documentId),
    ])
    for (const decision of attempts) expect(decision).toEqual({ ok: true })
  })
})
