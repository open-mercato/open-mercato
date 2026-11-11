/**
 * Real-upload-route counterpart to `attachmentAccessConcurrency.pg.test.ts`
 * (#8975 re-review). That suite proves the resolver's lock *selection*
 * against a real Postgres, but it calls `attachmentAccessResolvers[0].resolve`
 * directly inside a hand-rolled transaction — it never calls the generic
 * upload route, never persists an `Attachment` row, and never checks that a
 * denied upload cleans up the storage provider write or releases its quota
 * reservation.
 *
 * This suite drives the REAL exported `POST` handler from
 * `@open-mercato/core/modules/attachments/api/route` — the same function the
 * Next.js app wires to `POST /api/attachments` — against a real Postgres, so
 * the commit-boundary recheck inside its own `em.transactional` block takes
 * the REAL `lockDocumentAggregateRoot` row lock, not a mock. Only the request
 * container's non-Postgres dependencies (storage driver, quota service, rate
 * limiter) are test doubles, so cleanup/release calls are observable.
 *
 * Every contender uses an *acquisition barrier* — polling
 * `pg_stat_activity` for a real "idle in transaction" holder or a real lock
 * waiter — instead of a fixed sleep, so the ordering this suite proves is
 * driven by an observed Postgres lock state rather than a timing guess.
 * Every deferred signal is resolved from a `finally` block so a failed
 * assertion can never leave a contender's transaction open.
 *
 * Runs in the CI real-Postgres lane (`yarn workspace @open-mercato/documents
 * test:pg-integration`, OM_PG_INTEGRATION=1), which starts a disposable
 * container. Alternatively point OM_DOCUMENTS_PG_URL at a throwaway database.
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { registerAttachmentAccessResolvers } from '@open-mercato/core/modules/attachments/lib/access-registry'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import { Document, DocumentFolder, DocumentShare } from '../data/entities'
import { lockDocumentAggregateRoot } from '../commands/aggregate'
import { attachmentAccessResolvers, protectedAttachmentTargets } from '../data/attachment-access'
import { acquireDocumentsPgDatabase, runsAgainstPostgres, type DocumentsPgDatabase } from './documentsPgDatabase'

jest.mock('#generated/entities.ids.generated', () => ({
  E: { attachments: { attachment: 'attachments:attachment' }, catalog: {} },
}), { virtual: true })

const mockCreateRequestContainer = jest.fn()
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

const mockGetAuthFromRequest = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

const mockResolveAttachmentRequestScope = jest.fn()
jest.mock('@open-mercato/core/modules/attachments/lib/requestScope', () => ({
  resolveAttachmentRequestScope: (...args: unknown[]) => mockResolveAttachmentRequestScope(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}))

// The route only reaches this module when a partition requires OCR — never
// true here (requiresOcr is forced off below) — but the static import still
// has to resolve, and the real module pulls in the ESM-only `ai` SDK that
// Jest's CommonJS transform cannot parse.
jest.mock('@open-mercato/core/modules/attachments/lib/ocrService', () => ({
  OcrService: class { available = false },
  shouldUseLlmOcr: () => false,
}))

import { POST } from '@open-mercato/core/modules/attachments/api/route'

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

function createFakeStorageDriver() {
  return {
    key: 'fake',
    prepareStoragePath: jest.fn(({ fileName }: { fileName: string }) => `fake/${randomUUID()}-${fileName}`),
    store: jest.fn(async ({ storagePath }: { storagePath?: string }) => ({ storagePath: storagePath ?? `fake/${randomUUID()}` })),
    delete: jest.fn(async () => undefined),
    deleteStrict: jest.fn(async () => undefined),
    toLocalPath: jest.fn(async () => ({ filePath: '/tmp/fake', cleanup: async () => undefined })),
  }
}

function createFakeQuotaService() {
  let counter = 0
  return {
    reserve: jest.fn(async () => ({ id: `reservation-${++counter}`, leaseToken: `lease-${counter}`, expiresAt: new Date(Date.now() + 60_000) })),
    beginStorage: jest.fn(async () => undefined),
    markStored: jest.fn(async () => undefined),
    completeAttachment: jest.fn(async () => undefined),
    release: jest.fn(async () => undefined),
  }
}

maybe('generic upload route commit-boundary recheck vs. concurrent Documents mutations against PostgreSQL (#8975 re-review)', () => {
  jest.setTimeout(120_000)
  let orm: MikroORM
  let database: DocumentsPgDatabase | undefined
  let documentId: string
  let shareId: string

  const scope = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }
  let previousOcrEnabledEnv: string | undefined

  beforeAll(async () => {
    // `ensureDefaultPartitions` (called by the route itself, legacy storage
    // policy) seeds partitions with whatever `requiresOcr` defaults to at
    // instance-construction time. Force it off so the route takes its
    // non-OCR path — this suite proves lock/commit behavior, not OCR.
    previousOcrEnabledEnv = process.env.OM_DEFAULT_ATTACHMENT_OCR_ENABLED
    process.env.OM_DEFAULT_ATTACHMENT_OCR_ENABLED = 'false'
    database = await acquireDocumentsPgDatabase()
    orm = await MikroORM.init({
      clientUrl: database.url,
      entities: [Document, DocumentFolder, DocumentShare, Attachment, AttachmentPartition],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
    })
    await orm.schema.refresh()
  }, 120_000)

  afterAll(async () => {
    await orm?.close(true)
    await database?.release()
    if (previousOcrEnabledEnv === undefined) delete process.env.OM_DEFAULT_ATTACHMENT_OCR_ENABLED
    else process.env.OM_DEFAULT_ATTACHMENT_OCR_ENABLED = previousOcrEnabledEnv
  })

  beforeEach(async () => {
    jest.clearAllMocks()
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
    registerAttachmentAccessResolvers([{
      moduleId: 'documents',
      resolvers: attachmentAccessResolvers,
      protectedTargets: protectedAttachmentTargets,
    }])
    mockGetAuthFromRequest.mockResolvedValue({
      sub: EDITOR_ID, userId: EDITOR_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID, isApiKey: false,
    })
    mockResolveAttachmentRequestScope.mockResolvedValue({ denied: false, organizationId: ORGANIZATION_ID })
  })

  afterEach(() => registerAttachmentAccessResolvers([]))

  function buildContainer(options: {
    em: EntityManager
    storageDriver: ReturnType<typeof createFakeStorageDriver>
    quotaService: ReturnType<typeof createFakeQuotaService>
  }) {
    return {
      resolve: (key: string) => {
        switch (key) {
          case 'em': return options.em
          case 'dataEngine': return null
          case 'attachmentQuotaService': return options.quotaService
          case 'attachmentQuotaRecoveryScheduler': return jest.fn(async () => undefined)
          case 'rateLimiterService': return null
          case 'storageDriverFactory': return { resolveForPartition: jest.fn(async () => options.storageDriver) }
          case 'rbacService': return {
            loadAcl: async () => ({ isSuperAdmin: false, organizations: null }),
            getEffectiveFeatures: async () => ['documents.view', 'documents.edit'],
          }
          default: return null
        }
      },
    }
  }

  function buildUploadRequest(): Request {
    const form = new FormData()
    form.set('entityId', 'documents:document')
    form.set('recordId', documentId)
    form.set('file', new File([Buffer.from('upload-bytes')], 'contract.pdf', { type: 'application/pdf' }))
    return new Request('http://localhost/api/attachments', { method: 'POST', body: form as never })
  }

  // Drives the real route. Caller wires `createRequestContainer` to a fresh
  // Postgres-backed EntityManager and fake storage/quota doubles first.
  async function runUpload(): Promise<Response> {
    return POST(buildUploadRequest() as never)
  }

  // A concurrent `documents.share.delete` revoke, using the real exported
  // `lockDocumentAggregateRoot` the shares command takes before mutating.
  async function runConcurrentShareRevoke(): Promise<void> {
    const em = orm.em.fork()
    await em.transactional(async (tx) => {
      await lockDocumentAggregateRoot(tx, documentId, scope)
      await tx.nativeUpdate(DocumentShare, { id: shareId }, { deletedAt: new Date() })
    })
  }

  // A third, test-only transaction used only to force a deterministic lock
  // queue order between the upload and the revoke in the "upload wins" case.
  // It never represents application behavior.
  async function runLockSpacer(releaseSignal: Promise<void>): Promise<void> {
    const em = orm.em.fork()
    await em.transactional(async (tx) => {
      await lockDocumentAggregateRoot(tx, documentId, scope)
      await releaseSignal
    })
  }

  async function countAttachments(): Promise<number> {
    return orm.em.fork().count(Attachment, { entityId: 'documents:document', recordId: documentId })
  }

  async function isShareRevoked(): Promise<boolean> {
    const share = await orm.em.fork().findOneOrFail(DocumentShare, { id: shareId })
    return share.deletedAt != null
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

  it('denies the real upload route when a concurrent revoke commits first, cleans up the stored bytes and the quota reservation, and persists no attachment', async () => {
    const uploadEm = orm.em.fork()
    const storageDriver = createFakeStorageDriver()
    const quotaService = createFakeQuotaService()
    mockCreateRequestContainer.mockImplementation(async () => buildContainer({ em: uploadEm, storageDriver, quotaService }))

    const revoke = deferred()
    let revokePromise: Promise<void> | undefined
    let uploadPromise: Promise<Response> | undefined
    try {
      revokePromise = (async () => {
        const em = orm.em.fork()
        await em.transactional(async (tx) => {
          await lockDocumentAggregateRoot(tx, documentId, scope)
          await tx.nativeUpdate(DocumentShare, { id: shareId }, { deletedAt: new Date() })
          await revoke.promise
        })
      })()
      await waitForIdleInTransaction(1) // the revoke holds the row lock, soft-deleted share still uncommitted

      uploadPromise = runUpload()
      await waitForLockWaiters(1) // the upload's commit-boundary recheck is genuinely blocked on Postgres' row lock

      revoke.resolve() // the revoke transaction commits, releasing the row lock
      await revokePromise
      const response = await uploadPromise

      expect(response.status).toBe(404)
      expect(await countAttachments()).toBe(0) // the denied transaction rolled back; nothing committed
      expect(storageDriver.deleteStrict).toHaveBeenCalledTimes(1) // the already-stored bytes are compensated
      expect(storageDriver.deleteStrict).toHaveBeenCalledWith(expect.any(String), expect.any(String))
      expect(quotaService.release).toHaveBeenCalledTimes(1) // the quota reservation is released, not left dangling
      expect(await isShareRevoked()).toBe(true)
    } finally {
      revoke.resolve()
      await Promise.allSettled([revokePromise, uploadPromise])
    }
  })

  it('commits the real upload route first and makes a concurrent revoke wait until that attachment is committed', async () => {
    const uploadEm = orm.em.fork()
    const storageDriver = createFakeStorageDriver()
    const quotaService = createFakeQuotaService()
    mockCreateRequestContainer.mockImplementation(async () => buildContainer({ em: uploadEm, storageDriver, quotaService }))

    const spacer = deferred()
    const settleOrder: string[] = []
    let spacerPromise: Promise<void> | undefined
    let uploadPromise: Promise<Response> | undefined
    let revokePromise: Promise<void> | undefined
    try {
      // Force a deterministic queue order: hold the row lock on a throwaway
      // transaction until both the upload and the revoke are genuinely
      // queued behind it, upload first.
      spacerPromise = runLockSpacer(spacer.promise)
      await waitForIdleInTransaction(1) // the spacer holds the lock

      uploadPromise = runUpload().then((response) => { settleOrder.push('upload'); return response })
      await waitForLockWaiters(1) // the upload is now queued behind the spacer, first in line

      revokePromise = runConcurrentShareRevoke().then(() => { settleOrder.push('revoke') })
      await waitForLockWaiters(2) // the revoke is now queued behind the spacer too, second in line

      spacer.resolve() // release the lock; Postgres grants it to the upload first (FIFO wait queue)
      const response = await uploadPromise
      await revokePromise

      expect(response.status).toBe(200)
      expect(await countAttachments()).toBe(1) // the upload's attachment really committed
      expect(quotaService.completeAttachment).toHaveBeenCalledTimes(1)
      expect(storageDriver.deleteStrict).not.toHaveBeenCalled()
      expect(quotaService.release).not.toHaveBeenCalled()
      // The revoke only settles after the upload's transaction committed —
      // it genuinely waited on the held row lock rather than racing a plain read.
      expect(settleOrder).toEqual(['upload', 'revoke'])
      expect(await isShareRevoked()).toBe(true)
    } finally {
      spacer.resolve()
      await Promise.allSettled([spacerPromise, uploadPromise, revokePromise])
    }
  })
})
