import { randomUUID } from 'node:crypto'
import type { RequiredEntityData } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { InboxEmail, InboxEmailAttachment } from '../data/entities'
import {
  resendInboundAttachmentSchema,
  type InboxEmailAttachmentIngestMetadata,
  type ResendInboundAttachment,
} from '../data/validators'
import {
  enqueueInboundAttachmentIngestJob,
  INITIAL_INBOUND_ATTACHMENT_INGEST_GENERATION,
  capInboundAttachmentPlans,
  isInboundAttachmentIngestEnabled,
  nonDecorativeInboundAttachmentIds,
  planInboundAttachmentParts,
  readInboundAttachmentsConfigOrDefaults,
  reenqueueInboundAttachmentIngest,
  reportInboundAttachmentError,
  unguardedAttachmentReadersBlockingIngest,
  type InboundAttachmentEmailRef,
  type InboundAttachmentIngestEnqueuer,
  type InboundAttachmentPartPlan,
} from './inboundAttachments'
import {
  INBOX_OPS_ATTACHMENT_STRANDED_AFTER_MS,
  SELECT_STRANDED_INBOUND_ATTACHMENT_EMAILS_IN_SCOPE_SQL,
} from './inboundAttachmentMaintenance'
import type { InboundAttachmentsConfig } from './inboundAttachmentsConfig'

/**
 * The attachment side of the inbound webhook (spec "Webhook (`api/webhook/inbound.ts`)"): which
 * intake a Resend email gets, the email and its ledger rows written in one transaction, the first
 * ingest job, the duplicate-branch re-enqueue and the catch-up of an inbox's stranded emails.
 */

const logger = createLogger('inbox_ops').child({ component: 'inbound-attachment-webhook' })

export type InboundEmailScope = { tenantId: string; organizationId: string }

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

/** The metadata entries of `receiving.get()`; entries without a usable id or size are dropped. */
export function readResendInboundAttachments(raw: unknown): ResendInboundAttachment[] {
  if (!Array.isArray(raw)) return []
  const parts: ResendInboundAttachment[] = []
  let dropped = 0
  for (const entry of raw) {
    const parsed = resendInboundAttachmentSchema.safeParse(entry)
    if (parsed.success) parts.push(parsed.data)
    else dropped += 1
  }
  if (dropped > 0) logger.warn('Ignored malformed Resend attachment metadata entries', { dropped })
  return parts
}

/**
 * - `none`: no non-decorative part; the email follows today's path with today's hash.
 * - `ignored`: the kill switch is off or the attachment service is absent; today's path, but the
 *   hash includes the attachment ids (D13).
 * - `blocked`: an unguarded attachment reader is enabled (D19); the email is completed with
 *   `skipped`/`unguarded_reader` ledger rows and emitted at once.
 * - `ingest`: the email is persisted `pending` with its ledger rows and handed to the ingest worker.
 */
export type InboundAttachmentIntake =
  | { kind: 'none'; attachmentIds: string[] }
  | { kind: 'ignored'; attachmentIds: string[] }
  | { kind: 'blocked'; attachmentIds: string[]; readers: string[]; plans: InboundAttachmentPartPlan[]; omittedParts: number }
  | { kind: 'ingest'; attachmentIds: string[]; plans: InboundAttachmentPartPlan[]; omittedParts: number }

export const NO_INBOUND_ATTACHMENTS: InboundAttachmentIntake = { kind: 'none', attachmentIds: [] }

export type ResolveInboundAttachmentIntakeInput = {
  parts: readonly ResendInboundAttachment[]
  attachmentServiceAvailable: boolean
  config?: InboundAttachmentsConfig
  listReaders?: () => string[]
}

/**
 * The kill switch is checked first, then the attachment service, then the D19 gate. The planned
 * ledger rows are capped ({@link capInboundAttachmentPlans}); `attachmentIds` (the hash input)
 * still lists every non-decorative part.
 */
export function resolveInboundAttachmentIntake(input: ResolveInboundAttachmentIntakeInput): InboundAttachmentIntake {
  if (input.parts.length === 0) return NO_INBOUND_ATTACHMENTS
  const config = input.config ?? readInboundAttachmentsConfigOrDefaults()
  const attachmentIds = nonDecorativeInboundAttachmentIds(input.parts, config)
  if (attachmentIds.length === 0) return NO_INBOUND_ATTACHMENTS
  if (!config.enabled || !input.attachmentServiceAvailable) return { kind: 'ignored', attachmentIds }
  const gate = { config, listReaders: input.listReaders }
  const { plans, omittedParts } = capInboundAttachmentPlans(planInboundAttachmentParts(input.parts, config))
  if (omittedParts > 0) logger.warn('Inbound email lists more attachment parts than the ledger records', { omittedParts })
  if (isInboundAttachmentIngestEnabled(gate)) return { kind: 'ingest', attachmentIds, plans, omittedParts }
  return { kind: 'blocked', attachmentIds, readers: unguardedAttachmentReadersBlockingIngest(gate), plans, omittedParts }
}

export function intakeRecordsAttachments(
  intake: InboundAttachmentIntake,
): intake is Extract<InboundAttachmentIntake, { kind: 'blocked' | 'ingest' }> {
  return intake.kind === 'blocked' || intake.kind === 'ingest'
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export type InboundEmailValues = RequiredEntityData<InboxEmail>

type InboundEmailAttachmentState = Pick<
  RequiredEntityData<InboxEmail>,
  | 'attachmentsStatus'
  | 'metadata'
  | 'attachmentsIngestGeneration'
  | 'attachmentsCurrentGeneration'
  | 'attachmentsNextRunAt'
>

type InboundLedgerRowPlan = Omit<InboundAttachmentPartPlan, 'reason'> & {
  reason: InboundAttachmentPartPlan['reason'] | 'unguarded_reader'
}

/** D19 records every non-decorative part as `skipped`/`unguarded_reader`, whatever its limit outcome. */
function ledgerRowsFor(intake: Extract<InboundAttachmentIntake, { kind: 'blocked' | 'ingest' }>): InboundLedgerRowPlan[] {
  if (intake.kind === 'ingest') return intake.plans
  return intake.plans.map((plan) => (plan.reason === 'inline_decoration'
    ? plan
    : { ...plan, status: 'skipped', reason: 'unguarded_reader' }))
}

function attachmentStateFor(
  intake: Extract<InboundAttachmentIntake, { kind: 'blocked' | 'ingest' }>,
  providerEmailId: string,
  now: Date,
): InboundEmailAttachmentState {
  const attachmentIngest: InboxEmailAttachmentIngestMetadata = {
    provider: 'resend',
    providerEmailId,
    ...(intake.omittedParts > 0 ? { omittedParts: intake.omittedParts } : {}),
  }
  if (intake.kind === 'blocked') {
    return intake.omittedParts > 0
      ? { attachmentsStatus: 'completed', metadata: { attachmentIngest } }
      : { attachmentsStatus: 'completed' }
  }
  return {
    attachmentsStatus: 'pending',
    metadata: { attachmentIngest },
    attachmentsIngestGeneration: INITIAL_INBOUND_ATTACHMENT_INGEST_GENERATION,
    attachmentsCurrentGeneration: INITIAL_INBOUND_ATTACHMENT_INGEST_GENERATION,
    attachmentsNextRunAt: now,
  }
}

export type PersistInboundEmailWithLedgerInput = {
  em: EntityManager
  /** The `InboxEmail` values the webhook writes for every email. */
  values: InboundEmailValues
  intake: Extract<InboundAttachmentIntake, { kind: 'blocked' | 'ingest' }>
  providerEmailId: string
  now?: () => Date
  newId?: () => string
}

/**
 * Writes the email and one ledger row per planned (capped) metadata entry in one transaction. The rows are created
 * through the ORM, so the encryption subscriber encrypts `file_name`. Ledger `created_at` follows the
 * provider's part order, so the list route returns the parts in the order the sender attached them.
 * A unique-index violation propagates for the caller to answer as a duplicate.
 */
export async function persistInboundEmailWithLedger(input: PersistInboundEmailWithLedgerInput): Promise<InboxEmail> {
  const { em, intake } = input
  const now = (input.now ?? (() => new Date()))()
  const emailId = (input.newId ?? randomUUID)()
  const email = em.create(InboxEmail, {
    ...input.values,
    ...attachmentStateFor(intake, input.providerEmailId, now),
    id: emailId,
  })
  const ledgerRows = ledgerRowsFor(intake).map((row) => em.create(InboxEmailAttachment, {
    inboxEmailId: emailId,
    partKey: row.partKey,
    fileName: row.fileName,
    declaredMimeType: row.declaredMimeType,
    sizeBytes: row.sizeBytes,
    contentId: row.contentId,
    disposition: row.disposition,
    status: row.status,
    reason: row.reason,
    organizationId: input.values.organizationId,
    tenantId: input.values.tenantId,
    createdAt: new Date(now.getTime() + row.position),
  }))
  await withAtomicFlush(em, [
    () => {
      em.persist(email)
      for (const row of ledgerRows) em.persist(row)
    },
  ], { transaction: true, label: 'inbox_ops.webhook.persistInboundEmailWithLedger' })
  return email
}

/** The first ingest job of a new `pending` email, under the generation it was inserted with. */
export async function enqueueNewInboundAttachmentIngest(
  email: InboundAttachmentEmailRef,
  options: { queue?: InboundAttachmentIngestEnqueuer } = {},
): Promise<{ ok: true; jobId: string } | { ok: false; error: unknown }> {
  try {
    const jobId = await enqueueInboundAttachmentIngestJob(
      {
        emailId: email.id,
        tenantId: email.tenantId,
        organizationId: email.organizationId,
        generation: INITIAL_INBOUND_ATTACHMENT_INGEST_GENERATION,
      },
      { queue: options.queue },
    )
    return { ok: true, jobId }
  } catch (error) {
    logger.error('Failed to enqueue the attachment ingest of a new inbound email', { emailId: email.id })
    reportInboundAttachmentError(error, 'inbox_ops.attachment_requeue_failed', {
      emailId: email.id,
      tenantId: email.tenantId,
      step: 'webhook',
    })
    return { ok: false, error }
  }
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

type ReenqueueCandidate = Pick<
  InboxEmail,
  'id' | 'tenantId' | 'organizationId' | 'attachmentsStatus' | 'attachmentsClaimedAt' | 'deletedAt'
>

/** Still `pending`, or `processing` with an expired lease, and not soft-deleted. */
export function needsInboundAttachmentReenqueue(
  email: ReenqueueCandidate,
  options: { leaseMs: () => number; now: Date },
): boolean {
  if (email.deletedAt) return false
  if (email.attachmentsStatus === 'pending') return true
  if (email.attachmentsStatus !== 'processing') return false
  const claimedAt = email.attachmentsClaimedAt
  if (!claimedAt) return true
  return claimedAt.getTime() < options.now.getTime() - options.leaseMs()
}

export type DuplicateInboundAttachmentReenqueueOutcome = 'not_needed' | 'enqueued' | 'not_reserved' | 'enqueue_failed'

/**
 * The duplicate-branch rule, also applied to the email a unique-index violation collided with:
 * an email whose ingest is still pending, or processing with an expired lease, gets a new job.
 */
export async function reenqueueDuplicateInboundAttachmentIngest(input: {
  em: EntityManager
  email: ReenqueueCandidate
  config?: Pick<InboundAttachmentsConfig, 'leaseMs'>
  queue?: InboundAttachmentIngestEnqueuer
  now?: () => Date
}): Promise<DuplicateInboundAttachmentReenqueueOutcome> {
  const now = input.now ?? (() => new Date())
  const leaseMs = () => (input.config ?? readInboundAttachmentsConfigOrDefaults()).leaseMs
  if (!needsInboundAttachmentReenqueue(input.email, { leaseMs, now: now() })) return 'not_needed'
  const ref = { id: input.email.id, tenantId: input.email.tenantId, organizationId: input.email.organizationId }
  const result = await reenqueueInboundAttachmentIngest({ em: input.em, email: ref, queue: input.queue, now })
  if (result.kind !== 'enqueue_failed') return result.kind
  logger.error('Failed to re-enqueue the attachment ingest of a duplicate inbound email', { emailId: ref.id })
  reportInboundAttachmentError(result.error, 'inbox_ops.attachment_requeue_failed', {
    emailId: ref.id,
    tenantId: ref.tenantId,
    step: 'duplicate',
  })
  return 'enqueue_failed'
}

/**
 * The email a unique-index violation collided with. The unique indexes also cover soft-deleted
 * emails, which the regular duplicate check skips, so this lookup includes them.
 */
export async function findCollidingInboundEmail(
  em: EntityManager,
  scope: InboundEmailScope,
  keys: { messageId?: string | null; contentHash?: string | null },
): Promise<InboxEmail | null> {
  const where = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  if (keys.messageId) {
    const byMessageId = await findOneWithDecryption(em, InboxEmail, { ...where, messageId: keys.messageId }, undefined, scope)
    if (byMessageId) return byMessageId
  }
  if (keys.contentHash) {
    return findOneWithDecryption(em, InboxEmail, { ...where, contentHash: keys.contentHash }, undefined, scope)
  }
  return null
}

// ---------------------------------------------------------------------------
// Catch-up of stranded emails
// ---------------------------------------------------------------------------

export const INBOX_OPS_ATTACHMENT_CATCH_UP_INTERVAL_MS = 5 * 60 * 1000
export const INBOX_OPS_ATTACHMENT_CATCH_UP_BATCH = 10
const CATCH_UP_SCOPES_PRUNE_THRESHOLD = 1000

const catchUpRanAt = new Map<string, number>()

function scopeKey(scope: InboundEmailScope): string {
  return `${scope.tenantId}:${scope.organizationId}`
}

function claimCatchUpSlot(scope: InboundEmailScope, timestamp: number): boolean {
  const key = scopeKey(scope)
  const last = catchUpRanAt.get(key)
  if (last !== undefined && timestamp - last < INBOX_OPS_ATTACHMENT_CATCH_UP_INTERVAL_MS) return false
  if (catchUpRanAt.size >= CATCH_UP_SCOPES_PRUNE_THRESHOLD) {
    for (const [candidate, ranAt] of catchUpRanAt) {
      if (timestamp - ranAt >= INBOX_OPS_ATTACHMENT_CATCH_UP_INTERVAL_MS) catchUpRanAt.delete(candidate)
    }
  }
  catchUpRanAt.set(key, timestamp)
  return true
}

export type InboundAttachmentCatchUpResult =
  | { ran: false }
  | { ran: true; reenqueued: number; requeueFailed: number }

type StrandedRow = { id: string; tenant_id: string; organization_id: string }

/**
 * Re-enqueues up to 10 stranded emails of one inbox, at most once per process and scope every
 * 5 minutes. Each re-enqueue supersedes the email's earlier jobs, so catch-ups on several
 * processes never multiply job chains. Failures are reported; a failed selection throws.
 */
export async function catchUpStrandedInboundAttachmentIngests(input: {
  em: EntityManager
  scope: InboundEmailScope
  config?: Pick<InboundAttachmentsConfig, 'leaseMs'>
  queue?: InboundAttachmentIngestEnqueuer
  now?: () => Date
}): Promise<InboundAttachmentCatchUpResult> {
  const now = input.now ?? (() => new Date())
  const timestamp = now().getTime()
  if (!claimCatchUpSlot(input.scope, timestamp)) return { ran: false }
  const leaseMs = (input.config ?? readInboundAttachmentsConfigOrDefaults()).leaseMs
  const nextRunCutoff = new Date(timestamp - INBOX_OPS_ATTACHMENT_STRANDED_AFTER_MS)
  const leaseCutoff = new Date(timestamp - leaseMs)
  const rows = await input.em.getConnection().execute<StrandedRow[]>(SELECT_STRANDED_INBOUND_ATTACHMENT_EMAILS_IN_SCOPE_SQL, [
    input.scope.tenantId,
    input.scope.organizationId,
    nextRunCutoff,
    leaseCutoff,
    nextRunCutoff,
    INBOX_OPS_ATTACHMENT_CATCH_UP_BATCH,
  ])
  const result = { ran: true as const, reenqueued: 0, requeueFailed: 0 }
  for (const row of Array.isArray(rows) ? rows : []) {
    const email = { id: row.id, tenantId: row.tenant_id, organizationId: row.organization_id }
    const requeued = await reenqueueInboundAttachmentIngest({ em: input.em, email, queue: input.queue, now })
    if (requeued.kind === 'enqueued') {
      result.reenqueued += 1
    } else if (requeued.kind === 'enqueue_failed') {
      result.requeueFailed += 1
      logger.error('Failed to re-enqueue a stranded inbound attachment ingest during the webhook catch-up', { emailId: email.id })
      reportInboundAttachmentError(requeued.error, 'inbox_ops.attachment_requeue_failed', {
        emailId: email.id,
        tenantId: email.tenantId,
        step: 'catch_up',
      })
    }
  }
  return result
}

/** The webhook entry point: never throws, so the catch-up can never change the response. */
export async function catchUpStrandedInboundAttachmentIngestsSafely(
  input: Parameters<typeof catchUpStrandedInboundAttachmentIngests>[0],
): Promise<InboundAttachmentCatchUpResult | null> {
  try {
    return await catchUpStrandedInboundAttachmentIngests(input)
  } catch (error) {
    logger.error('Failed to catch up stranded inbound attachment ingests', { tenantId: input.scope.tenantId, err: error })
    reportInboundAttachmentError(error, 'inbox_ops.attachment_requeue_failed', {
      tenantId: input.scope.tenantId,
      step: 'catch_up',
    })
    return null
  }
}

/** Test helper: forgets the per-process catch-up throttle. */
export function resetInboundAttachmentCatchUpForTests(): void {
  catchUpRanAt.clear()
}
