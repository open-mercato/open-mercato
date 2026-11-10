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

type Deferred = { promise: Promise<void>; resolve: () => void }

function deferred(): Deferred {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

maybe('attachment upload commit-boundary recheck vs. concurrent Documents mutations against PostgreSQL (#8975)', () => {
  jest.setTimeout(120_000)
  let orm: MikroORM
  let database: DocumentsPgDatabase | undefined
  let documentId: string
  let shareId: string

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

  it('blocks the commit-boundary recheck on Postgres row lock until a concurrent revoke commits, then denies on the now-revoked share', async () => {
    const revoke = deferred()
    const revokePromise = runConcurrentShareRevoke(revoke.promise)
    await delay(200) // let the revoke acquire the row lock and soft-delete the share, still uncommitted

    let uploadSettled = false
    const uploadPromise = runUploadCommitBoundaryCheck().then((decision) => {
      uploadSettled = true
      return decision
    })
    await delay(200)
    expect(uploadSettled).toBe(false) // genuinely blocked on Postgres' row lock, not a JS mutex

    revoke.resolve() // the revoke transaction commits, releasing the row lock
    await revokePromise

    const decision = await uploadPromise
    expect(uploadSettled).toBe(true)
    expect(decision).toEqual({ ok: false, status: 404, reason: 'document_not_found' })
    expect(await isShareRevoked()).toBe(true)
  })

  it('lets the commit-boundary recheck finish and commit first on Postgres, serializing a queued revoke behind it', async () => {
    const upload = deferred()
    let uploadSettled = false
    const uploadPromise = runUploadCommitBoundaryCheck(upload.promise).then((decision) => {
      uploadSettled = true
      return decision
    })
    await delay(200) // let the upload acquire the row lock and obtain its decision first

    let revokeSettled = false
    const revokePromise = runConcurrentShareRevoke().then(() => { revokeSettled = true })
    await delay(200)
    expect(revokeSettled).toBe(false) // queued behind the still-open upload transaction
    expect(await isShareRevoked()).toBe(false)

    upload.resolve() // the upload transaction commits, releasing the row lock
    const decision = await uploadPromise
    expect(uploadSettled).toBe(true)
    expect(decision).toEqual({ ok: true })

    await revokePromise
    expect(revokeSettled).toBe(true)
    expect(await isShareRevoked()).toBe(true) // the revoke only lands after the upload committed
  })
})
