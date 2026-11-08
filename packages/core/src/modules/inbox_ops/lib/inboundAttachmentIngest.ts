import { randomUUID } from 'node:crypto'
import { raw } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AbandonedJobInfo } from '@open-mercato/queue'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getGlobalEventBus } from '@open-mercato/shared/modules/events'
import type { AttachmentService } from '@open-mercato/core/modules/attachments'
import {
  InboxEmail,
  InboxEmailAttachment,
  type InboxEmailAttachmentReason,
  type InboxEmailAttachmentStatus,
} from '../data/entities'
import {
  inboundAttachmentIngestJobSchema,
  inboxEmailAttachmentIngestMetadataSchema,
  type InboundAttachmentIngestJob,
} from '../data/validators'
import { emitInboxOpsEvent } from '../events'
import {
  INBOX_OPS_ATTACHMENT_INGEST_QUEUE_ATTEMPTS,
  persistInboundPart,
  reenqueueInboundAttachmentIngest,
  readInboundAttachmentsConfigOrDefaults,
  reportInboundAttachmentError,
  unguardedAttachmentReadersBlockingIngest,
  warnIfStoredInboundAttachmentsReadableByUnguardedReaders,
  type InboundAttachmentEmailRef,
  type InboundAttachmentErrorCode,
  type InboundAttachmentIngestEnqueuer,
} from './inboundAttachments'
import type { InboundAttachmentsConfig } from './inboundAttachmentsConfig'
import {
  acquireInboundPartBytes,
  createResendInboundAttachmentsApi,
  listInboundAttachmentDescriptors,
  type FetchLike,
  type ListedInboundAttachments,
  type ResendInboundAttachmentsApi,
} from './resendInboundAttachments'

/**
 * The ingest worker's run (spec `2026-10-25-inbox-ops-inbound-attachments.md`, Ingest worker
 * steps 1–6): claim, acquire, persist, finish, retry and report. Every write to `inbox_emails`
 * leaves `updated_at` unchanged; every ledger write is conditional on the claim.
 */

const logger = createLogger('inbox_ops').child({ component: 'attachment-ingest' })

/** An email whose parts kept failing is finalized once its first failure is this old. */
export const INBOX_OPS_ATTACHMENT_FINALIZE_AFTER_MS = 6 * 60 * 60 * 1000

const PART_KEY_PREFIX = 'resend:'

/** The unchanged `inbox_ops.email.received` payload of the webhook, plus the optional stored-part count. */
export type InboxEmailReceivedEventPayload = {
  emailId: string
  tenantId: string
  organizationId: string
  forwardedByAddress: string
  subject: string
  attachmentCount?: number
}

export type InboxEmailReceivedEmitter = (
  payload: InboxEmailReceivedEventPayload,
  options: { persistent: true; tenantId: string; organizationId: string },
) => Promise<void>

/** Emits through the module emitter; a missing event bus is a failed emit, so the event is retried, not dropped. */
export const emitInboxEmailReceived: InboxEmailReceivedEmitter = async (payload, options) => {
  if (!getGlobalEventBus()) throw new Error('[internal] event bus unavailable')
  await emitInboxOpsEvent('inbox_ops.email.received', payload, options)
}

export class InboundAttachmentIngestRetryError extends Error {
  readonly reason: InboundAttachmentRetryReason

  constructor(reason: InboundAttachmentRetryReason) {
    super(`[internal] inbound attachment ingest will be retried (${reason})`)
    this.name = 'InboundAttachmentIngestRetryError'
    this.reason = reason
  }
}

export type InboundAttachmentRetryReason = 'transient_parts' | 'emit_failed'

export type InboundAttachmentIngestDeps = {
  em: EntityManager
  /** Resolved softly; without it pending parts fail with `store_failed` and the email completes. */
  attachmentService?: Pick<AttachmentService, 'createScoped'> | null
  encryptionService: Pick<TenantDataEncryptionService, 'encryptEntityPayload'>
  createResendApi?: () => ResendInboundAttachmentsApi
  fetchImpl?: FetchLike
  emitReceived?: InboxEmailReceivedEmitter
  queue?: InboundAttachmentIngestEnqueuer
  config?: InboundAttachmentsConfig
  listUnguardedReaders?: () => string[]
  now?: () => Date
  newClaimToken?: () => string
}

export type InboundAttachmentIngestOutcome =
  | 'missing'
  | 'superseded'
  | 'deleted'
  | 'already_completed'
  | 'claim_lost'
  | 'lease_live_requeued'
  | 'completed'
  | 'finalized'
  | 'retry_requeued'

export type InboundAttachmentIngestRunResult = {
  outcome: InboundAttachmentIngestOutcome
  storedCount?: number
}

type Claim = InboundAttachmentEmailRef & { token: string }

type LedgerRow = Pick<
  InboxEmailAttachment,
  'id' | 'partKey' | 'fileName' | 'declaredMimeType' | 'status' | 'attempts' | 'inFlightAt' | 'attachmentId'
>

type PartResolution =
  | { kind: 'status'; status: Extract<InboxEmailAttachmentStatus, 'skipped' | 'failed'>; reason: InboxEmailAttachmentReason }
  | { kind: 'stored'; mimeType?: string; sizeBytes?: number }
  | { kind: 'transient'; code: string }

type PartRunOutcome = 'resolved' | 'transient' | 'aborted'

type PartSource = {
  kind: 'source'
  api: ResendInboundAttachmentsApi
  providerEmailId: string
  listed: ListedInboundAttachments
}

function isSuperseded(email: Pick<InboxEmail, 'attachmentsCurrentGeneration'>, generation: number): boolean {
  return generation < (email.attachmentsCurrentGeneration ?? 0)
}

function providerAttachmentIdFromPartKey(partKey: string): string | null {
  if (!partKey.startsWith(PART_KEY_PREFIX)) return null
  const id = partKey.slice(PART_KEY_PREFIX.length)
  return id.length > 0 ? id : null
}

function reportCodeForReason(reason: InboxEmailAttachmentReason): InboundAttachmentErrorCode | null {
  switch (reason) {
    case 'fetch_failed':
      return 'inbox_ops.attachment_fetch_failed'
    case 'store_failed':
    case 'processing_failed':
    case 'quota_exceeded':
    case 'partition_unavailable':
      return 'inbox_ops.attachment_store_failed'
    case 'ingest_timeout':
      return 'inbox_ops.attachment_ingest_timeout'
    default:
      return null
  }
}

function reportFailedParts(ref: InboundAttachmentEmailRef, reason: InboxEmailAttachmentReason, parts: number): void {
  const code = reportCodeForReason(reason)
  if (!code || parts <= 0) return
  logger.warn('Inbound attachment parts failed', { emailId: ref.id, reason, parts })
  reportInboundAttachmentError(new Error(`[internal] inbound attachment part failed: ${reason}`), code, {
    emailId: ref.id,
    tenantId: ref.tenantId,
    reason,
    parts,
  })
}

async function loadEmail(em: EntityManager, ref: InboundAttachmentEmailRef): Promise<InboxEmail | null> {
  return findOneWithDecryption(
    em,
    InboxEmail,
    { id: ref.id, tenantId: ref.tenantId, organizationId: ref.organizationId },
    { refresh: true },
    { tenantId: ref.tenantId, organizationId: ref.organizationId },
  )
}

/** A soft-deleted email whose ingest is still open is completed without an emit. */
export async function completeDeletedInboundAttachmentIngest(em: EntityManager, ref: InboundAttachmentEmailRef): Promise<boolean> {
  const updated = await em.nativeUpdate(
    InboxEmail,
    {
      id: ref.id,
      tenantId: ref.tenantId,
      organizationId: ref.organizationId,
      deletedAt: { $ne: null },
      attachmentsStatus: { $in: ['pending', 'processing'] },
    },
    { attachmentsStatus: 'completed', attachmentsClaimToken: null },
  )
  return updated > 0
}

/**
 * Step 1: claims a `pending` email, or a `processing` one whose lease expired (which starts the
 * 6-hour clock), unless the job was superseded after its read. Returns whether it claimed.
 */
export async function claimInboundAttachmentIngest(
  em: EntityManager,
  ref: InboundAttachmentEmailRef,
  input: { generation: number; token: string; now: Date; leaseMs: number },
): Promise<boolean> {
  const leaseCutoff = new Date(input.now.getTime() - input.leaseMs)
  const updated = await em.nativeUpdate(
    InboxEmail,
    {
      id: ref.id,
      tenantId: ref.tenantId,
      organizationId: ref.organizationId,
      deletedAt: null,
      $and: [
        { $or: [{ attachmentsCurrentGeneration: null }, { attachmentsCurrentGeneration: { $lte: input.generation } }] },
        {
          $or: [
            { attachmentsStatus: 'pending' },
            { attachmentsStatus: 'processing', attachmentsClaimedAt: null },
            { attachmentsStatus: 'processing', attachmentsClaimedAt: { $lt: leaseCutoff } },
          ],
        },
      ],
    },
    {
      attachmentsStatus: 'processing',
      attachmentsClaimToken: input.token,
      attachmentsClaimedAt: input.now,
      attachmentsFirstFailureAt: raw(
        `case when "attachments_status" = 'processing' then coalesce("attachments_first_failure_at", ?) else "attachments_first_failure_at" end`,
        [input.now],
      ),
    },
  )
  return updated > 0
}

/** Renews the claim and, in the same transaction (so it holds the email row lock), runs a ledger write. */
async function withClaim(
  em: EntityManager,
  claim: Claim,
  now: () => Date,
  write?: (tx: EntityManager) => Promise<unknown>,
): Promise<boolean> {
  return em.transactional(async (tx) => {
    const renewed = await tx.nativeUpdate(
      InboxEmail,
      {
        id: claim.id,
        tenantId: claim.tenantId,
        organizationId: claim.organizationId,
        attachmentsClaimToken: claim.token,
        deletedAt: null,
      },
      { attachmentsClaimedAt: now() },
    )
    if (renewed === 0) return false
    if (write) await write(tx)
    return true
  })
}

type IngestRunContext = {
  job: InboundAttachmentIngestJob
  attemptNumber: number
  deps: InboundAttachmentIngestDeps
  em: EntityManager
  config: InboundAttachmentsConfig
  now: () => Date
  ref: InboundAttachmentEmailRef
  ledgerScope: { inboxEmailId: string; tenantId: string; organizationId: string }
  decryptionScope: { tenantId: string; organizationId: string }
  /** The ledger row whose `in_flight_at` this run set and has not cleared yet. */
  inFlightRowId: string | null
}

function createRunContext(
  job: InboundAttachmentIngestJob,
  attemptNumber: number,
  deps: InboundAttachmentIngestDeps,
): IngestRunContext {
  return {
    job,
    attemptNumber,
    deps,
    em: deps.em,
    config: deps.config ?? readInboundAttachmentsConfigOrDefaults(),
    now: deps.now ?? (() => new Date()),
    ref: { id: job.emailId, tenantId: job.tenantId, organizationId: job.organizationId },
    ledgerScope: { inboxEmailId: job.emailId, tenantId: job.tenantId, organizationId: job.organizationId },
    decryptionScope: { tenantId: job.tenantId, organizationId: job.organizationId },
    inFlightRowId: null,
  }
}

async function settleUnclaimable(
  run: IngestRunContext,
  email: InboxEmail | null,
): Promise<InboundAttachmentIngestRunResult | null> {
  if (!email || email.attachmentsStatus == null) return { outcome: 'missing' }
  if (isSuperseded(email, run.job.generation)) return { outcome: 'superseded' }
  if (email.deletedAt) {
    await completeDeletedInboundAttachmentIngest(run.em, run.ref)
    return { outcome: 'deleted' }
  }
  if (email.attachmentsStatus === 'completed') return { outcome: 'already_completed' }
  return null
}

/** Errors this module reported before rethrowing, so the run's catch-all does not report them twice. */
const reportedRunErrors = new WeakSet<object>()

async function reenqueueSelf(run: IngestRunContext, delayMs: number): Promise<boolean> {
  const result = await reenqueueInboundAttachmentIngest({
    em: run.em,
    email: run.ref,
    delayMs,
    jobGeneration: run.job.generation,
    queue: run.deps.queue,
    now: run.now,
  })
  if (result.kind === 'enqueue_failed') {
    logger.error('Failed to re-enqueue an inbound attachment ingest job', { emailId: run.ref.id, generation: run.job.generation })
    reportInboundAttachmentError(result.error, 'inbox_ops.attachment_requeue_failed', {
      emailId: run.ref.id,
      tenantId: run.ref.tenantId,
      generation: run.job.generation,
    })
    if (result.error && typeof result.error === 'object') reportedRunErrors.add(result.error)
    throw result.error
  }
  return result.kind === 'enqueued'
}

/** Another claim's lease is still live: re-enqueue after it, so a fast retry after a crash cannot end the chain. */
async function afterLostClaimRace(run: IngestRunContext): Promise<InboundAttachmentIngestRunResult> {
  const current = await loadEmail(run.em, run.ref)
  const settled = await settleUnclaimable(run, current)
  if (settled) return settled
  const claimedAt = current?.attachmentsClaimedAt?.getTime()
  if (current?.attachmentsStatus !== 'processing' || claimedAt === undefined) return { outcome: 'claim_lost' }
  const remainingLeaseMs = claimedAt + run.config.leaseMs - run.now().getTime()
  if (remainingLeaseMs <= 0) return { outcome: 'claim_lost' }
  const requeued = await reenqueueSelf(run, remainingLeaseMs)
  return { outcome: requeued ? 'lease_live_requeued' : 'superseded' }
}

async function loadLedger(run: IngestRunContext, status?: InboxEmailAttachmentStatus): Promise<LedgerRow[]> {
  return findWithDecryption(
    run.em,
    InboxEmailAttachment,
    { ...run.ledgerScope, deletedAt: null, ...(status ? { status } : {}) },
    { orderBy: { createdAt: 'asc', partKey: 'asc' }, refresh: true },
    run.decryptionScope,
  )
}

async function resolveAllPending(
  run: IngestRunContext,
  claim: Claim,
  status: Extract<InboxEmailAttachmentStatus, 'skipped' | 'failed'>,
  reason: InboxEmailAttachmentReason,
): Promise<boolean> {
  let resolvedParts = 0
  const resolved = await withClaim(run.em, claim, run.now, async (tx) => {
    resolvedParts = await tx.nativeUpdate(
      InboxEmailAttachment,
      { ...run.ledgerScope, status: 'pending' },
      { status, reason, inFlightAt: null, updatedAt: run.now() },
    )
  })
  if (resolved && status === 'failed') reportFailedParts(run.ref, reason, resolvedParts)
  return resolved
}

async function acquireAndPersist(
  run: IngestRunContext,
  claim: Claim,
  row: LedgerRow,
  source: PartSource,
  textExtraction: 'return' | 'none',
): Promise<PartResolution | 'aborted'> {
  const providerAttachmentId = providerAttachmentIdFromPartKey(row.partKey)
  if (!providerAttachmentId) return { kind: 'status', status: 'failed', reason: 'fetch_failed' }
  const acquired = await acquireInboundPartBytes({
    api: source.api,
    providerEmailId: source.providerEmailId,
    providerAttachmentId,
    listed: source.listed.byId.get(providerAttachmentId),
    timeoutMs: run.config.fetchTimeoutMs,
    maxBytes: run.config.maxFileBytes,
    fetchImpl: run.deps.fetchImpl,
    now: run.now,
  })
  if (acquired.kind === 'not_found') return { kind: 'status', status: 'failed', reason: 'fetch_failed' }
  if (acquired.kind === 'too_large') return { kind: 'status', status: 'skipped', reason: 'too_large' }
  if (acquired.kind === 'transient') return { kind: 'transient', code: acquired.code }

  const attachmentService = run.deps.attachmentService
  if (!attachmentService) return { kind: 'status', status: 'failed', reason: 'store_failed' }
  const persisted = await persistInboundPart({
    attachmentService,
    encryptionService: run.deps.encryptionService,
    email: run.ref,
    claimToken: claim.token,
    part: { id: row.id, status: 'pending', fileName: row.fileName ?? null, declaredMimeType: row.declaredMimeType ?? null },
    buffer: acquired.buffer,
    config: run.config,
    textExtraction,
    now: run.now,
  })
  switch (persisted.kind) {
    case 'stored':
      return persisted.alreadyStored
        ? { kind: 'stored' }
        : { kind: 'stored', mimeType: persisted.mimeType, sizeBytes: persisted.fileSize }
    case 'skipped':
      return { kind: 'status', status: 'skipped', reason: persisted.reason }
    case 'failed':
      return { kind: 'status', status: 'failed', reason: persisted.reason }
    case 'transient':
      return { kind: 'transient', code: persisted.code }
    case 'aborted':
      return 'aborted'
  }
}

function writePartResolution(run: IngestRunContext, tx: EntityManager, rowId: string, resolution: PartResolution): Promise<number> {
  const timestamp = run.now()
  if (resolution.kind === 'status') {
    return tx.nativeUpdate(
      InboxEmailAttachment,
      { ...run.ledgerScope, id: rowId, status: 'pending' },
      { status: resolution.status, reason: resolution.reason, inFlightAt: null, updatedAt: timestamp },
    )
  }
  if (resolution.kind === 'stored' && resolution.mimeType !== undefined) {
    return tx.nativeUpdate(
      InboxEmailAttachment,
      { ...run.ledgerScope, id: rowId },
      { inFlightAt: null, mimeType: resolution.mimeType, sizeBytes: resolution.sizeBytes ?? null, updatedAt: timestamp },
    )
  }
  return tx.nativeUpdate(InboxEmailAttachment, { ...run.ledgerScope, id: rowId }, { inFlightAt: null, updatedAt: timestamp })
}

/**
 * Step 3 for one part: `in_flight_at` is committed before the first provider call and cleared when
 * the attempt ends, so a part found with it set was interrupted by a crash and counts an attempt.
 * The last allowed attempt stores the file without text; a part beyond it fails `processing_failed`.
 */
async function processPart(run: IngestRunContext, claim: Claim, row: LedgerRow, source: PartSource): Promise<PartRunOutcome> {
  const attempts = (row.attempts ?? 0) + (row.inFlightAt ? 1 : 0)
  if (attempts >= run.config.maxPartAttempts) {
    const marked = await withClaim(run.em, claim, run.now, (tx) => tx.nativeUpdate(
      InboxEmailAttachment,
      { ...run.ledgerScope, id: row.id, status: 'pending' },
      { status: 'failed', reason: 'processing_failed', attempts, inFlightAt: null, updatedAt: run.now() },
    ))
    if (!marked) return 'aborted'
    reportFailedParts(run.ref, 'processing_failed', 1)
    return 'resolved'
  }

  const started = await withClaim(run.em, claim, run.now, (tx) => tx.nativeUpdate(
    InboxEmailAttachment,
    { ...run.ledgerScope, id: row.id, status: 'pending' },
    { inFlightAt: run.now(), attempts, updatedAt: run.now() },
  ))
  if (!started) return 'aborted'
  run.inFlightRowId = row.id

  const textExtraction = attempts >= run.config.maxPartAttempts - 1 ? 'none' : 'return'
  const resolution = await acquireAndPersist(run, claim, row, source, textExtraction)
  if (resolution === 'aborted') return 'aborted'

  const written = await withClaim(run.em, claim, run.now, (tx) => writePartResolution(run, tx, row.id, resolution))
  if (!written) return 'aborted'
  run.inFlightRowId = null

  if (resolution.kind === 'status' && resolution.status === 'failed') reportFailedParts(run.ref, resolution.reason, 1)
  if (resolution.kind === 'transient') {
    logger.warn('Inbound attachment part failed transiently', { emailId: run.ref.id, partId: row.id, code: resolution.code })
    return 'transient'
  }
  return 'resolved'
}

/**
 * Marks the remaining pending parts `ingest_timeout` in one transaction that starts with a
 * conditional update on the email; a manual retry that reset the clock meanwhile skips it.
 */
async function finalizeIfTimedOut(run: IngestRunContext, claim: Claim): Promise<boolean> {
  const cutoff = new Date(run.now().getTime() - INBOX_OPS_ATTACHMENT_FINALIZE_AFTER_MS)
  let timedOutParts = 0
  const finalized = await run.em.transactional(async (tx) => {
    const locked = await tx.nativeUpdate(
      InboxEmail,
      {
        id: claim.id,
        tenantId: claim.tenantId,
        organizationId: claim.organizationId,
        attachmentsClaimToken: claim.token,
        deletedAt: null,
        attachmentsFirstFailureAt: { $lt: cutoff },
      },
      { attachmentsClaimedAt: run.now() },
    )
    if (locked === 0) return false
    timedOutParts = await tx.nativeUpdate(
      InboxEmailAttachment,
      { ...run.ledgerScope, status: 'pending' },
      { status: 'failed', reason: 'ingest_timeout', inFlightAt: null, updatedAt: run.now() },
    )
    return true
  })
  if (finalized) reportFailedParts(run.ref, 'ingest_timeout', timedOutParts)
  return finalized
}

/**
 * Step 5: back to `pending` (claim token cleared, due now), then rethrow so the queue retries
 * within seconds; on the queue's last attempt, a fresh delayed job replaces the rethrow.
 */
async function retryLater(run: IngestRunContext, claim: Claim, reason: InboundAttachmentRetryReason): Promise<InboundAttachmentIngestRunResult> {
  const reset = await run.em.nativeUpdate(
    InboxEmail,
    { id: claim.id, tenantId: claim.tenantId, organizationId: claim.organizationId, attachmentsClaimToken: claim.token },
    { attachmentsStatus: 'pending', attachmentsClaimToken: null, attachmentsNextRunAt: run.now() },
  )
  if (reset === 0) return { outcome: 'claim_lost' }
  if (run.attemptNumber < INBOX_OPS_ATTACHMENT_INGEST_QUEUE_ATTEMPTS) throw new InboundAttachmentIngestRetryError(reason)
  const requeued = await reenqueueSelf(run, run.config.retryDelayMs)
  return { outcome: requeued ? 'retry_requeued' : 'superseded' }
}

/** Step 4: mirror, emit the unchanged event, then complete conditional on the claim token. */
async function finish(run: IngestRunContext, claim: Claim, email: InboxEmail): Promise<InboundAttachmentIngestRunResult> {
  const stored = await loadLedger(run, 'stored')
  const attachmentIds = stored
    .map((row) => row.attachmentId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  const mirrored = await run.em.nativeUpdate(
    InboxEmail,
    { id: claim.id, tenantId: claim.tenantId, organizationId: claim.organizationId, attachmentsClaimToken: claim.token, deletedAt: null },
    { attachmentIds, attachmentsClaimedAt: run.now() },
  )
  if (mirrored === 0) return { outcome: 'claim_lost' }

  try {
    await (run.deps.emitReceived ?? emitInboxEmailReceived)(
      {
        emailId: claim.id,
        tenantId: claim.tenantId,
        organizationId: claim.organizationId,
        forwardedByAddress: email.forwardedByAddress,
        subject: email.subject,
        attachmentCount: stored.length,
      },
      { persistent: true, tenantId: claim.tenantId, organizationId: claim.organizationId },
    )
  } catch (error) {
    logger.warn('Failed to emit inbox_ops.email.received after attachment ingest', { emailId: claim.id, err: error })
    reportInboundAttachmentError(error, 'inbox_ops.attachment_emit_failed', {
      emailId: claim.id,
      tenantId: claim.tenantId,
      generation: run.job.generation,
    })
    return retryLater(run, claim, 'emit_failed')
  }

  const completed = await run.em.nativeUpdate(
    InboxEmail,
    { id: claim.id, tenantId: claim.tenantId, organizationId: claim.organizationId, attachmentsClaimToken: claim.token },
    { attachmentsStatus: 'completed', attachmentsClaimToken: null },
  )
  if (completed === 0) logger.warn('Inbound attachment ingest emitted but lost its claim before completing', { emailId: claim.id })
  return { outcome: 'completed', storedCount: stored.length }
}

async function openPartSource(
  run: IngestRunContext,
  email: InboxEmail,
): Promise<PartSource | { kind: 'unfetchable' } | { kind: 'provider_unavailable' }> {
  const ingestMetadata = inboxEmailAttachmentIngestMetadataSchema.safeParse(email.metadata?.attachmentIngest)
  if (!ingestMetadata.success) return { kind: 'unfetchable' }
  let api: ResendInboundAttachmentsApi
  try {
    api = (run.deps.createResendApi ?? createResendInboundAttachmentsApi)()
  } catch (error) {
    logger.warn('Resend client unavailable for inbound attachments', { emailId: run.ref.id })
    reportInboundAttachmentError(error, 'inbox_ops.attachment_provider_unavailable', {
      emailId: run.ref.id,
      tenantId: run.ref.tenantId,
    })
    return { kind: 'provider_unavailable' }
  }
  const providerEmailId = ingestMetadata.data.providerEmailId
  const listed = await listInboundAttachmentDescriptors(api, providerEmailId, run.config.fetchTimeoutMs)
  if (listed.emailNotFound) return { kind: 'unfetchable' }
  return { kind: 'source', api, providerEmailId, listed }
}

/** Steps 2–5 under a claim. */
async function ingestClaimed(run: IngestRunContext, claim: Claim, email: InboxEmail): Promise<InboundAttachmentIngestRunResult> {
  const readers = unguardedAttachmentReadersBlockingIngest({ config: run.config, listReaders: run.deps.listUnguardedReaders })
  if (readers.length > 0) {
    try {
      await warnIfStoredInboundAttachmentsReadableByUnguardedReaders(run.em, readers, run.now)
    } catch (error) {
      logger.warn('Failed to check stored inbound attachments against unguarded readers', { err: error })
    }
    if (!await resolveAllPending(run, claim, 'skipped', 'unguarded_reader')) return { outcome: 'claim_lost' }
    return finish(run, claim, email)
  }

  const pending = (await loadLedger(run)).filter((row) => row.status === 'pending')
  if (pending.length === 0) return finish(run, claim, email)

  if (!run.deps.attachmentService) {
    if (!await resolveAllPending(run, claim, 'failed', 'store_failed')) return { outcome: 'claim_lost' }
    return finish(run, claim, email)
  }

  const source = await openPartSource(run, email)
  if (source.kind === 'unfetchable') {
    if (!await resolveAllPending(run, claim, 'failed', 'fetch_failed')) return { outcome: 'claim_lost' }
    return finish(run, claim, email)
  }

  let transientParts = 0
  if (source.kind === 'provider_unavailable') {
    transientParts = pending.length
  } else {
    for (const row of pending) {
      const outcome = await processPart(run, claim, row, source)
      if (outcome === 'aborted') return { outcome: 'claim_lost' }
      if (outcome === 'transient') transientParts += 1
    }
  }
  if (transientParts === 0) return finish(run, claim, email)

  const clockStarted = await withClaim(run.em, claim, run.now, (tx) => tx.nativeUpdate(
    InboxEmail,
    {
      id: claim.id,
      tenantId: claim.tenantId,
      organizationId: claim.organizationId,
      attachmentsClaimToken: claim.token,
      attachmentsFirstFailureAt: null,
    },
    { attachmentsFirstFailureAt: run.now() },
  ))
  if (!clockStarted) return { outcome: 'claim_lost' }

  if (await finalizeIfTimedOut(run, claim)) {
    const result = await finish(run, claim, email)
    return result.outcome === 'completed' ? { ...result, outcome: 'finalized' } : result
  }
  return retryLater(run, claim, 'transient_parts')
}

/**
 * After an unexpected error under the claim (a database blip, a bug): reports it as
 * `inbox_ops.attachment_ingest_failed` (unless a step already reported it), clears `in_flight_at` of the part this run was processing,
 * so the error is not charged as a crash on the next run, starts the 6-hour clock if it has not
 * started, and resets the email to `pending` with the lease released and due now. The writes are
 * conditional on the claim token; a cleanup failure is logged and the original error still
 * propagates. The clock only dates the fault: finalization still happens only at the end of a run
 * that attempted every remaining `pending` part (step 5), so parts nobody tried never time out.
 */
async function releaseClaimAfterError(run: IngestRunContext, claim: Claim, error: unknown): Promise<void> {
  if (!(error && typeof error === 'object' && reportedRunErrors.has(error))) {
    logger.warn('Inbound attachment ingest run failed unexpectedly', { emailId: claim.id, generation: run.job.generation })
    reportInboundAttachmentError(error, 'inbox_ops.attachment_ingest_failed', {
      emailId: claim.id,
      tenantId: claim.tenantId,
      generation: run.job.generation,
    })
  }
  try {
    await run.em.transactional(async (tx) => {
      const claimed = { id: claim.id, tenantId: claim.tenantId, organizationId: claim.organizationId, attachmentsClaimToken: claim.token }
      await tx.nativeUpdate(InboxEmail, { ...claimed, attachmentsFirstFailureAt: null }, { attachmentsFirstFailureAt: run.now() })
      const reset = await tx.nativeUpdate(
        InboxEmail,
        claimed,
        { attachmentsStatus: 'pending', attachmentsClaimToken: null, attachmentsNextRunAt: run.now() },
      )
      if (reset === 0 || !run.inFlightRowId) return
      await tx.nativeUpdate(
        InboxEmailAttachment,
        { ...run.ledgerScope, id: run.inFlightRowId, status: 'pending' },
        { inFlightAt: null, updatedAt: run.now() },
      )
    })
    run.inFlightRowId = null
  } catch (cleanupError) {
    logger.warn('Failed to release an inbound attachment claim after an unexpected error', { emailId: claim.id, err: cleanupError })
  }
}

/** One ingest run for one job. Throws `InboundAttachmentIngestRetryError` to let the queue retry. */
export async function runInboundAttachmentIngest(
  job: InboundAttachmentIngestJob,
  context: { attemptNumber: number },
  deps: InboundAttachmentIngestDeps,
): Promise<InboundAttachmentIngestRunResult> {
  const run = createRunContext(job, context.attemptNumber, deps)
  const email = await loadEmail(run.em, run.ref)
  const settled = await settleUnclaimable(run, email)
  if (settled || !email) return settled ?? { outcome: 'missing' }

  const token = (deps.newClaimToken ?? randomUUID)()
  const claimed = await claimInboundAttachmentIngest(run.em, run.ref, {
    generation: job.generation,
    token,
    now: run.now(),
    leaseMs: run.config.leaseMs,
  })
  if (!claimed) return afterLostClaimRace(run)
  const claim = { ...run.ref, token }
  try {
    return await ingestClaimed(run, claim, email)
  } catch (error) {
    // A planned retry already reset the email to `pending` (and cleared the claim) before throwing.
    if (!(error instanceof InboundAttachmentIngestRetryError)) await releaseClaimAfterError(run, claim, error)
    throw error
  }
}

export type AbandonedInboundAttachmentIngestDeps = {
  em?: EntityManager
  queue?: InboundAttachmentIngestEnqueuer
  now?: () => Date
}

async function resolveRequestEm(): Promise<EntityManager> {
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const container = await createRequestContainer()
  return (container.resolve('em') as EntityManager).fork()
}

/**
 * `WorkerMeta.onJobAbandoned`: receives the queued-job envelope. Reports are delivered at least
 * once, so a stale one (its generation superseded) neither re-enqueues nor starts the clock.
 */
export async function handleAbandonedInboundAttachmentIngestJob(
  envelope: unknown,
  info: AbandonedJobInfo,
  deps: AbandonedInboundAttachmentIngestDeps = {},
): Promise<void> {
  const payload = envelope && typeof envelope === 'object' ? (envelope as { payload?: unknown }).payload : undefined
  const parsed = inboundAttachmentIngestJobSchema.safeParse(payload)
  if (!parsed.success) return
  const job = parsed.data
  const em = deps.em ?? await resolveRequestEm()
  const now = deps.now ?? (() => new Date())
  const ref = { id: job.emailId, tenantId: job.tenantId, organizationId: job.organizationId }

  await em.nativeUpdate(
    InboxEmail,
    {
      id: ref.id,
      tenantId: ref.tenantId,
      organizationId: ref.organizationId,
      deletedAt: null,
      attachmentsStatus: { $in: ['pending', 'processing'] },
      attachmentsFirstFailureAt: null,
      $or: [{ attachmentsCurrentGeneration: null }, { attachmentsCurrentGeneration: { $lte: job.generation } }],
    },
    { attachmentsFirstFailureAt: now() },
  )

  const result = await reenqueueInboundAttachmentIngest({ em, email: ref, jobGeneration: job.generation, queue: deps.queue, now })
  if (result.kind === 'enqueue_failed') {
    logger.error('Failed to re-enqueue an abandoned inbound attachment ingest job', { emailId: ref.id, jobId: info.jobId })
    reportInboundAttachmentError(result.error, 'inbox_ops.attachment_requeue_failed', {
      emailId: ref.id,
      tenantId: ref.tenantId,
      generation: job.generation,
    })
    throw result.error
  }
}
