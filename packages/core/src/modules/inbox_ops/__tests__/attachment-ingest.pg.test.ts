/**
 * Inbound attachment ingest SQL against a real PostgreSQL: the leased claim, the generation
 * reservation (`UPDATE … RETURNING`) and its confirmation, the deletion update and its row lock
 * against `persistLink`'s claim renewal, the sweep selections, a whole ingest run and the release.
 * Every write must leave `inbox_emails.updated_at` unchanged.
 *
 * Gated on OM_INBOX_OPS_PG_URL — a throwaway database, since the suite drops and recreates the
 * `inbox_emails` and `inbox_email_attachments` tables. Never point it at a development or shared
 * database. For example:
 *
 *   createdb om_inbox_ingest_scratch
 *   OM_INBOX_OPS_PG_URL=postgres://localhost:5432/om_inbox_ingest_scratch \
 *     yarn workspace @open-mercato/core jest attachment-ingest.pg
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CreateScopedAttachmentInput } from '@open-mercato/core/modules/attachments'
import { InboxEmail, InboxEmailAttachment, type InboxEmailAttachmentsStatus } from '../data/entities'
import { claimInboundAttachmentIngest, runInboundAttachmentIngest } from '../lib/inboundAttachmentIngest'
import {
  INBOX_OPS_ATTACHMENT_SWEEP_BATCH,
  SELECT_DELETED_OPEN_INBOUND_ATTACHMENT_EMAILS_SQL,
  SELECT_STRANDED_INBOUND_ATTACHMENT_EMAILS_SQL,
  SELECT_UNRELEASED_DELETED_INBOUND_EMAILS_SQL,
} from '../lib/inboundAttachmentMaintenance'
import { releaseInboundEmailAttachments, softDeleteInboxEmailForRelease } from '../lib/inboundAttachmentRelease'
import { persistInboundPart, reenqueueInboundAttachmentIngest } from '../lib/inboundAttachments'
import { readInboundAttachmentsConfig } from '../lib/inboundAttachmentsConfig'

const PG_URL = process.env.OM_INBOX_OPS_PG_URL ?? ''
const maybe = PG_URL ? describe : describe.skip

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const UPDATED_AT = new Date('2026-01-01T00:00:00.000Z')
const LEASE_MS = 30 * 60 * 1000
const MINUTE = 60 * 1000

const identityEncryption = {
  encryptEntityPayload: async (_entityId: string, payload: Record<string, unknown>) => payload,
}

function delay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

maybe('inbound attachment ingest SQL against PostgreSQL', () => {
  jest.setTimeout(120_000)
  let orm: MikroORM

  beforeAll(async () => {
    orm = await MikroORM.init({
      clientUrl: PG_URL,
      entities: [InboxEmail, InboxEmailAttachment],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
      pool: { min: 0, max: 20 },
    })
    await orm.schema.refresh()
  }, 60_000)

  afterAll(async () => {
    await orm?.close(true)
  })

  async function seedEmail(values: Partial<{
    status: InboxEmailAttachmentsStatus | null
    claimToken: string | null
    claimedAt: Date | null
    firstFailureAt: Date | null
    ingestGeneration: number
    currentGeneration: number
    nextRunAt: Date | null
    deletedAt: Date | null
    releaseRequestedAt: Date | null
  }> = {}): Promise<string> {
    const em = orm.em.fork()
    const email = em.create(InboxEmail, {
      forwardedByAddress: 'sender@example.test',
      toAddress: 'inbox@example.test',
      subject: 'Offer',
      receivedAt: new Date(),
      status: 'received',
      isActive: true,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      metadata: { attachmentIngest: { provider: 'resend', providerEmailId: 'resend-email-1' } },
      attachmentsStatus: values.status === undefined ? 'pending' : values.status,
      attachmentsClaimToken: values.claimToken ?? null,
      attachmentsClaimedAt: values.claimedAt ?? null,
      attachmentsFirstFailureAt: values.firstFailureAt ?? null,
      attachmentsIngestGeneration: values.ingestGeneration ?? 1,
      attachmentsCurrentGeneration: values.currentGeneration ?? 1,
      attachmentsNextRunAt: values.nextRunAt === undefined ? new Date() : values.nextRunAt,
      attachmentsReleaseRequestedAt: values.releaseRequestedAt ?? null,
      deletedAt: values.deletedAt ?? null,
      createdAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
    })
    em.persist(email)
    await em.flush()
    return email.id
  }

  async function seedPart(emailId: string, providerId: string, status: InboxEmailAttachment['status'] = 'pending', attachmentId: string | null = null): Promise<string> {
    const em = orm.em.fork()
    const row = em.create(InboxEmailAttachment, {
      inboxEmailId: emailId,
      partKey: `resend:${providerId}`,
      fileName: `${providerId}.pdf`,
      declaredMimeType: 'application/pdf',
      sizeBytes: 3,
      disposition: 'attachment',
      status,
      attachmentId,
      extractedText: status === 'stored' ? 'text' : null,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
    })
    em.persist(row)
    await em.flush()
    return row.id
  }

  async function readEmail(id: string): Promise<InboxEmail> {
    const email = await orm.em.fork().findOneOrFail(InboxEmail, { id })
    return email
  }

  function ref(id: string) {
    return { id, tenantId: TENANT_ID, organizationId: ORG_ID }
  }

  describe('claim', () => {
    it('claims a pending email once and leaves updated_at unchanged', async () => {
      const id = await seedEmail()
      const now = new Date()
      const first = await claimInboundAttachmentIngest(orm.em.fork(), ref(id), { generation: 1, token: randomUUID(), now, leaseMs: LEASE_MS })
      const second = await claimInboundAttachmentIngest(orm.em.fork(), ref(id), { generation: 1, token: randomUUID(), now, leaseMs: LEASE_MS })
      expect([first, second]).toEqual([true, false])
      const email = await readEmail(id)
      expect(email.attachmentsStatus).toBe('processing')
      expect(email.attachmentsFirstFailureAt).toBeNull()
      expect(email.updatedAt.toISOString()).toBe(UPDATED_AT.toISOString())
    })

    it('lets exactly one of many concurrent claims win', async () => {
      const id = await seedEmail()
      const now = new Date()
      const results = await Promise.all(Array.from({ length: 8 }, () =>
        claimInboundAttachmentIngest(orm.em.fork(), ref(id), { generation: 1, token: randomUUID(), now, leaseMs: LEASE_MS })))
      expect(results.filter(Boolean)).toHaveLength(1)
    })

    it('takes over an expired lease and starts the 6-hour clock only once', async () => {
      const firstFailure = new Date(Date.now() - 2 * 60 * MINUTE)
      const expiredId = await seedEmail({ status: 'processing', claimToken: randomUUID(), claimedAt: new Date(Date.now() - LEASE_MS - MINUTE) })
      const keptId = await seedEmail({ status: 'processing', claimToken: randomUUID(), claimedAt: new Date(Date.now() - LEASE_MS - MINUTE), firstFailureAt: firstFailure })
      const now = new Date()
      expect(await claimInboundAttachmentIngest(orm.em.fork(), ref(expiredId), { generation: 1, token: randomUUID(), now, leaseMs: LEASE_MS })).toBe(true)
      expect(await claimInboundAttachmentIngest(orm.em.fork(), ref(keptId), { generation: 1, token: randomUUID(), now, leaseMs: LEASE_MS })).toBe(true)
      expect((await readEmail(expiredId)).attachmentsFirstFailureAt?.toISOString()).toBe(now.toISOString())
      expect((await readEmail(keptId)).attachmentsFirstFailureAt?.toISOString()).toBe(firstFailure.toISOString())
    })

    it('refuses a live lease, a superseded job and a deleted email', async () => {
      const liveId = await seedEmail({ status: 'processing', claimToken: randomUUID(), claimedAt: new Date() })
      const supersededId = await seedEmail({ ingestGeneration: 3, currentGeneration: 3 })
      const deletedId = await seedEmail({ deletedAt: new Date() })
      const claim = (id: string, generation: number) =>
        claimInboundAttachmentIngest(orm.em.fork(), ref(id), { generation, token: randomUUID(), now: new Date(), leaseMs: LEASE_MS })
      expect(await claim(liveId, 1)).toBe(false)
      expect(await claim(supersededId, 2)).toBe(false)
      expect(await claim(supersededId, 3)).toBe(true)
      expect(await claim(deletedId, 1)).toBe(false)
    })
  })

  describe('re-enqueue helper', () => {
    it('hands concurrent callers different generations and confirms only the newest', async () => {
      const id = await seedEmail()
      const enqueued: number[] = []
      const queue = { enqueue: jest.fn(async (job: { generation: number }) => { enqueued.push(job.generation); return `job-${job.generation}` }) }
      const results = await Promise.all(Array.from({ length: 6 }, () =>
        reenqueueInboundAttachmentIngest({ em: orm.em.fork(), email: ref(id), queue })))
      const generations = results.map((result) => (result.kind === 'enqueued' ? result.generation : 0))
      expect(new Set(generations).size).toBe(6)
      expect(generations.every((generation) => generation >= 2 && generation <= 7)).toBe(true)
      const email = await readEmail(id)
      expect(email.attachmentsIngestGeneration).toBe(7)
      expect(email.attachmentsCurrentGeneration).toBe(7)
      expect(email.updatedAt.toISOString()).toBe(UPDATED_AT.toISOString())
    })

    it('keeps the previous job current when the enqueue fails, even for two concurrent failures', async () => {
      const nextRunAt = new Date(Date.now() - 20 * MINUTE)
      const id = await seedEmail({ nextRunAt })
      const queue = { enqueue: jest.fn(async () => { throw new Error('redis down') }) }
      const results = await Promise.all([
        reenqueueInboundAttachmentIngest({ em: orm.em.fork(), email: ref(id), queue }),
        reenqueueInboundAttachmentIngest({ em: orm.em.fork(), email: ref(id), queue }),
      ])
      expect(results.map((result) => result.kind)).toEqual(['enqueue_failed', 'enqueue_failed'])
      const email = await readEmail(id)
      expect(email.attachmentsCurrentGeneration).toBe(1)
      expect(email.attachmentsNextRunAt?.toISOString()).toBe(nextRunAt.toISOString())
    })

    it('sets the due time from the delay and never lets a late confirmation undo a newer one', async () => {
      const id = await seedEmail()
      const now = new Date()
      const queue = { enqueue: jest.fn(async () => 'job') }
      const delayed = await reenqueueInboundAttachmentIngest({ em: orm.em.fork(), email: ref(id), queue, delayMs: 15 * MINUTE, now: () => now })
      expect(delayed).toMatchObject({ kind: 'enqueued', generation: 2, confirmed: true })
      expect(queue.enqueue).toHaveBeenCalledWith({ emailId: id, tenantId: TENANT_ID, organizationId: ORG_ID, generation: 2 }, { delayMs: 15 * MINUTE })
      expect((await readEmail(id)).attachmentsNextRunAt?.toISOString()).toBe(new Date(now.getTime() + 15 * MINUTE).toISOString())

      await orm.em.fork().nativeUpdate(InboxEmail, { id }, { attachmentsCurrentGeneration: 5, attachmentsIngestGeneration: 5 })
      const late = await reenqueueInboundAttachmentIngest({ em: orm.em.fork(), email: ref(id), queue })
      expect(late).toMatchObject({ kind: 'enqueued', generation: 6, confirmed: true })
      await orm.em.fork().nativeUpdate(InboxEmail, { id }, { attachmentsCurrentGeneration: 9 })
      const stale = await reenqueueInboundAttachmentIngest({ em: orm.em.fork(), email: ref(id), queue })
      expect(stale).toMatchObject({ kind: 'enqueued', generation: 7, confirmed: false })
      expect((await readEmail(id)).attachmentsCurrentGeneration).toBe(9)
    })

    it('reserves nothing for completed, deleted or superseded callers', async () => {
      const queue = { enqueue: jest.fn(async () => 'job') }
      const completedId = await seedEmail({ status: 'completed' })
      const deletedId = await seedEmail({ deletedAt: new Date() })
      const supersededId = await seedEmail({ ingestGeneration: 4, currentGeneration: 4 })
      expect(await reenqueueInboundAttachmentIngest({ em: orm.em.fork(), email: ref(completedId), queue })).toEqual({ kind: 'not_reserved' })
      expect(await reenqueueInboundAttachmentIngest({ em: orm.em.fork(), email: ref(deletedId), queue })).toEqual({ kind: 'not_reserved' })
      expect(await reenqueueInboundAttachmentIngest({ em: orm.em.fork(), email: ref(supersededId), queue, jobGeneration: 3 })).toEqual({ kind: 'not_reserved' })
      expect(queue.enqueue).not.toHaveBeenCalled()
      expect((await readEmail(supersededId)).attachmentsIngestGeneration).toBe(4)
    })
  })

  describe('deletion', () => {
    it('soft-deletes, requests release, clears the claim and completes only an ingest email', async () => {
      const ingestId = await seedEmail({ status: 'processing', claimToken: randomUUID(), claimedAt: new Date() })
      const plainId = await seedEmail({ status: null })
      expect(await softDeleteInboxEmailForRelease(orm.em.fork(), ref(ingestId))).toBe(true)
      expect(await softDeleteInboxEmailForRelease(orm.em.fork(), ref(plainId))).toBe(true)
      expect(await softDeleteInboxEmailForRelease(orm.em.fork(), ref(plainId))).toBe(false)
      const ingest = await readEmail(ingestId)
      const plain = await readEmail(plainId)
      expect(ingest).toMatchObject({ attachmentsStatus: 'completed', attachmentsClaimToken: null })
      expect(ingest.deletedAt).not.toBeNull()
      expect(ingest.attachmentsReleaseRequestedAt).not.toBeNull()
      expect(plain.attachmentsStatus).toBeNull()
      expect(plain.attachmentsReleaseRequestedAt).not.toBeNull()
      expect(ingest.updatedAt.toISOString()).toBe(UPDATED_AT.toISOString())
    })

    it('waits for a persistLink holding the claim, and a part attempted after the delete rolls back', async () => {
      const token = randomUUID()
      const id = await seedEmail({ status: 'processing', claimToken: token, claimedAt: new Date() })
      const committedPart = await seedPart(id, 'committed')
      const latePart = await seedPart(id, 'late')
      const config = { maxFileBytes: 1024, maxTextCharsPerFile: 100 }
      let releaseLink: () => void = () => undefined
      const linkHeld = new Promise<void>((done) => { releaseLink = done })
      let linkEntered: () => void = () => undefined
      const entered = new Promise<void>((done) => { linkEntered = done })
      const slowService = {
        createScoped: async (input: CreateScopedAttachmentInput) => {
          await orm.em.fork().transactional(async (tx) => {
            await input.persistLink?.(tx, '99999999-9999-4999-8999-999999999999', { content: 'hello' })
            linkEntered()
            await linkHeld
          })
          return { id: '99999999-9999-4999-8999-999999999999', mimeType: 'application/pdf', fileSize: 3 } as never
        },
      }
      const persisting = persistInboundPart({
        attachmentService: slowService,
        encryptionService: identityEncryption,
        email: ref(id),
        claimToken: token,
        part: { id: committedPart, status: 'pending', fileName: 'committed.pdf', declaredMimeType: 'application/pdf' },
        buffer: Buffer.from('pdf'),
        config,
      })
      await entered
      const deleting = softDeleteInboxEmailForRelease(orm.em.fork(), ref(id))
      await delay(300)
      let deleteSettled = false
      void deleting.then(() => { deleteSettled = true })
      await delay(50)
      expect(deleteSettled).toBe(false)
      releaseLink()
      expect(await persisting).toMatchObject({ kind: 'stored', alreadyStored: false })
      expect(await deleting).toBe(true)

      const lateService = {
        createScoped: async (input: CreateScopedAttachmentInput) => {
          await orm.em.fork().transactional(async (tx) => {
            await input.persistLink?.(tx, '88888888-8888-4888-8888-888888888888', { content: 'late' })
          })
          return { id: '88888888-8888-4888-8888-888888888888', mimeType: 'application/pdf', fileSize: 3 } as never
        },
      }
      const late = await persistInboundPart({
        attachmentService: lateService,
        encryptionService: identityEncryption,
        email: ref(id),
        claimToken: token,
        part: { id: latePart, status: 'pending', fileName: 'late.pdf', declaredMimeType: 'application/pdf' },
        buffer: Buffer.from('pdf'),
        config,
      })
      expect(late).toEqual({ kind: 'aborted', code: 'inbox_claim_lost' })
      const rows = await orm.em.fork().find(InboxEmailAttachment, { inboxEmailId: id }, { orderBy: { partKey: 'asc' } })
      expect(rows.map((row) => [row.partKey, row.status])).toEqual([
        ['resend:committed', 'stored'],
        ['resend:late', 'pending'],
      ])
    })

    it('releases stored parts, clears names and text, and marks the email released only after a full release', async () => {
      const id = await seedEmail({ status: 'completed' })
      await seedPart(id, 'stored-a', 'stored', '77777777-7777-4777-8777-777777777771')
      await seedPart(id, 'shared', 'stored', '77777777-7777-4777-8777-777777777772')
      await seedPart(id, 'skipped', 'skipped')
      await softDeleteInboxEmailForRelease(orm.em.fork(), ref(id))
      const releaseScoped = jest.fn(async (input: { attachmentId: string }) => {
        if (input.attachmentId.endsWith('2')) throw new CrudHttpError(409, { error: 'still referenced' })
      })
      const releaseOwnedScoped = jest.fn()
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValue({ deleted: 0, repointed: 0, detached: 1 })

      const first = await releaseInboundEmailAttachments({ em: orm.em.fork(), email: ref(id), attachmentService: { releaseScoped, releaseOwnedScoped }, encryptionService: identityEncryption })
      expect(first).toMatchObject({ fullyReleased: false, releasedParts: 1, remainingParts: 1 })
      expect((await readEmail(id)).attachmentsReleasedAt).toBeNull()

      const second = await releaseInboundEmailAttachments({ em: orm.em.fork(), email: ref(id), attachmentService: { releaseScoped, releaseOwnedScoped }, encryptionService: identityEncryption })
      expect(second).toMatchObject({ fullyReleased: true, markedReleased: true, remainingParts: 0 })
      const rows = await orm.em.fork().find(InboxEmailAttachment, { inboxEmailId: id })
      expect(rows.every((row) => row.status === 'released' && row.fileName === null && row.extractedText === null)).toBe(true)
      const email = await readEmail(id)
      expect(email.attachmentsReleasedAt).not.toBeNull()
      expect(email.updatedAt.toISOString()).toBe(UPDATED_AT.toISOString())
    })
  })

  describe('sweep selections', () => {
    beforeEach(async () => {
      await orm.em.fork().nativeDelete(InboxEmailAttachment, {})
      await orm.em.fork().nativeDelete(InboxEmail, {})
    })

    it('selects stranded emails only 15 minutes past their due time', async () => {
      const now = Date.now()
      const strandedPending = await seedEmail({ nextRunAt: new Date(now - 16 * MINUTE) })
      await seedEmail({ nextRunAt: new Date(now - 14 * MINUTE) })
      await seedEmail({ nextRunAt: new Date(now + 15 * MINUTE) })
      await seedEmail({ status: 'processing', claimToken: randomUUID(), claimedAt: new Date(now - LEASE_MS - MINUTE), nextRunAt: new Date(now - 5 * MINUTE) })
      const strandedProcessing = await seedEmail({ status: 'processing', claimToken: randomUUID(), claimedAt: new Date(now - LEASE_MS - MINUTE), nextRunAt: new Date(now - 40 * MINUTE) })
      await seedEmail({ status: 'processing', claimToken: randomUUID(), claimedAt: new Date(now - MINUTE), nextRunAt: new Date(now - 40 * MINUTE) })
      await seedEmail({ nextRunAt: new Date(now - 60 * MINUTE), deletedAt: new Date() })
      const cutoff = new Date(now - 15 * MINUTE)
      const rows = await orm.em.fork().getConnection().execute<Array<{ id: string }>>(
        SELECT_STRANDED_INBOUND_ATTACHMENT_EMAILS_SQL,
        [cutoff, new Date(now - LEASE_MS), cutoff, INBOX_OPS_ATTACHMENT_SWEEP_BATCH],
      )
      expect(rows.map((row) => row.id)).toEqual([strandedProcessing, strandedPending])
    })

    it('selects open ingests of deleted emails and unreleased deletions, never pre-upgrade deletions', async () => {
      const deletedPending = await seedEmail({ deletedAt: new Date() })
      const deletedPlain = await seedEmail({ status: null, deletedAt: new Date(), releaseRequestedAt: new Date() })
      await seedEmail({ status: null, deletedAt: new Date() })
      const open = await orm.em.fork().getConnection().execute<Array<{ id: string }>>(SELECT_DELETED_OPEN_INBOUND_ATTACHMENT_EMAILS_SQL, [100])
      expect(open.map((row) => row.id)).toEqual([deletedPending])
      const unreleased = await orm.em.fork().getConnection().execute<Array<{ id: string }>>(SELECT_UNRELEASED_DELETED_INBOUND_EMAILS_SQL, [100])
      expect(unreleased.map((row) => row.id).sort()).toEqual([deletedPending, deletedPlain].sort())
    })
  })

  describe('a whole ingest run', () => {
    it('stores parts, mirrors attachment ids, emits once and completes without touching updated_at', async () => {
      const id = await seedEmail()
      await seedPart(id, 'a')
      await seedPart(id, 'b')
      const expiresAt = new Date(Date.now() + 60 * MINUTE).toISOString()
      const api = {
        list: jest.fn(async () => ({
          data: { has_more: false, data: ['a', 'b'].map((key) => ({ id: key, download_url: `https://files.example.test/${key}`, expires_at: expiresAt })) },
          error: null,
        })),
        get: jest.fn(),
      }
      const fetchImpl = jest.fn(async () => new Response(Buffer.from('pdf'), { status: 200 }))
      let counter = 0
      const attachmentService = {
        createScoped: async (input: CreateScopedAttachmentInput) => {
          counter += 1
          const attachmentId = `66666666-6666-4666-8666-66666666666${counter}`
          await orm.em.fork().transactional(async (tx) => {
            await input.persistLink?.(tx, attachmentId, { content: `text ${counter}` })
          })
          return { id: attachmentId, mimeType: 'application/pdf', fileSize: 3 } as never
        },
      }
      const emitReceived = jest.fn(async () => undefined)
      const result = await runInboundAttachmentIngest(
        { emailId: id, tenantId: TENANT_ID, organizationId: ORG_ID, generation: 1 },
        { attemptNumber: 1 },
        {
          em: orm.em.fork(),
          attachmentService,
          encryptionService: identityEncryption,
          createResendApi: () => api,
          fetchImpl,
          emitReceived,
          config: readInboundAttachmentsConfig({}),
          listUnguardedReaders: () => [],
        },
      )
      expect(result).toEqual({ outcome: 'completed', storedCount: 2 })
      expect(emitReceived).toHaveBeenCalledTimes(1)
      expect(emitReceived).toHaveBeenCalledWith(
        { emailId: id, tenantId: TENANT_ID, organizationId: ORG_ID, forwardedByAddress: 'sender@example.test', subject: 'Offer', attachmentCount: 2 },
        { persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID },
      )
      const email = await readEmail(id)
      expect(email.attachmentsStatus).toBe('completed')
      expect(email.attachmentsClaimToken).toBeNull()
      expect([...(email.attachmentIds ?? [])].sort()).toEqual([
        '66666666-6666-4666-8666-666666666661',
        '66666666-6666-4666-8666-666666666662',
      ])
      expect(email.updatedAt.toISOString()).toBe(UPDATED_AT.toISOString())
      const rows = await orm.em.fork().find(InboxEmailAttachment, { inboxEmailId: id })
      expect(rows.map((row) => [row.status, row.mimeType, row.sizeBytes, row.inFlightAt, row.attempts])).toEqual([
        ['stored', 'application/pdf', 3, null, 0],
        ['stored', 'application/pdf', 3, null, 0],
      ])
    })
  })
})
