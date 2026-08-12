/**
 * The DEADLINE half of the external runtime (external-agent-invocation design
 * §5.5; risk **R2**; tracker task 2.7) — what happens when the phone call nobody
 * answers is the only thing a workflow is waiting for.
 *
 * `ExternalAgentRunner` parks a step and hands a provider a callback URL. If that
 * callback never arrives — no answer, a provider outage, a webhook lost in
 * transit, a connector that dialled and crashed — nothing else in the system will
 * ever move that step again. R2 is rated **High** for exactly this: a live
 * business process stops, silently, forever. This module is the only thing that
 * stops it, so it is built to work even when parts of the platform do not.
 *
 * ## Two mechanisms, deliberately
 *
 * The design (§5.5) names one: "enqueue a delayed job at `start()`". T2.1 built a
 * second: the `(organization_id, status, expires_at)` index, which exists for a
 * SWEEP. Both ship, because each covers the other's blind spot and neither alone
 * discharges a High-severity "never" requirement:
 *
 * | | Delayed job (targeted) | Periodic tick (sweep) |
 * |---|---|---|
 * | Fires | at the deadline, to the second | within one interval of it |
 * | Covers | the run it was enqueued for | every `pending` row, however it got there |
 * | Lost when | the queue backend drops it (Redis eviction, a wiped `.mercato/queue`, a strategy change), or the enqueue itself failed after the call was already placed | `@open-mercato/scheduler` is absent (it is an OPTIONAL peer) or the organization's `seedDefaults` never ran |
 *
 * The failure modes do not overlap, and the second column's first row is the
 * decisive one: a mitigation for a High risk must not be contingent on an
 * optional package being installed. The delayed job therefore carries the
 * guarantee on a bare deployment; the periodic tick makes the guarantee
 * SELF-HEALING — it catches rows created before this feature shipped, rows whose
 * job was lost, and rows whose enqueue threw while the provider was already
 * dialling. Running both is safe at zero cost because the settlement is
 * single-shot in SQL (see below), so a double fire is a no-op, not a double
 * resume.
 *
 * ## Racing a callback
 *
 * The sweep introduces NO new decision point. Expiry goes through the same
 * `completeExternalRun` and therefore the same conditional `pending → terminal`
 * UPDATE that a redelivered webhook goes through. Under Postgres READ COMMITTED
 * two concurrent updates of one row serialise on the row lock, and the second
 * re-evaluates its `status = 'pending'` predicate against the committed result —
 * so exactly one of {callback, sweep} sees `claimed: true` and everything after
 * the claim (fail the run, write the row, send the resume signal, hang up) is
 * behind that flag. A callback that loses reports `already_settled` and answers
 * 200; a sweep that loses does nothing at all and does not even cancel.
 *
 * ## Cancellation is best-effort, and always last
 *
 * `connector.cancel?.()` is optional (T2.2) and runs AFTER the workflow has been
 * freed, inside its own try/catch. The point of this module is that the workflow
 * is released regardless: a provider being down is the most likely reason the
 * callback never came, so letting its `cancel` throw block the expiry would make
 * the outage cause the exact parked-forever state the sweep exists to prevent.
 */

import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentExternalRun } from '../../data/entities'
import {
  AGENT_ORCHESTRATOR_EXTERNAL_RUN_SWEEP_QUEUE,
  getAgentOrchestratorQueue,
  type ExternalRunSweepJobPayload,
} from '../queue'
import { completeExternalRun, type CompleteExternalRunResult } from './completeExternalRun'
import {
  getExternalAgentConnector,
  type ExternalAgentConnectorScope,
} from './externalConnectorRegistry'

const logger = createLogger('agent_orchestrator').child({ component: 'external-run-sweep' })

/**
 * How far PAST `expires_at` a row must be before the sweep gives up on it.
 *
 * The deadline is the moment we stop waiting, not the moment we race whatever is
 * in flight. A callback being processed at that instant deserves to win, and this
 * grace also absorbs clock skew between the process that computed `expires_at`
 * and the process running the sweep — a real gap in a multi-replica deployment.
 * It is not a correctness device (the single-shot claim already makes a
 * photo-finish safe, whoever wins); it only biases the outcome toward the real
 * answer, which is the better one. Trivial against any plausible deadline.
 */
export const EXTERNAL_RUN_EXPIRY_GRACE_MS = 5_000

/**
 * Rows expired per periodic tick, per organization.
 *
 * The tick is idempotent and the index makes the query cheap, so a backlog is
 * simply drained over successive ticks rather than pinning one worker (and its
 * pooled DB connection) through hundreds of `sendSignal` round-trips in a single
 * job. Every skipped row is still `pending` and still past its deadline, so the
 * next tick selects it again.
 */
const SWEEP_BATCH_LIMIT = 100

/**
 * The columns the expiry path needs. Deliberately NOT the entity: `request_payload`,
 * `result_payload` and `failure_reason` are encrypted PII (a brief, a transcript),
 * and the sweep has no use for any of them — not projecting them means nothing to
 * decrypt and no transcript materialised inside a background job.
 */
type ExpirableExternalRun = {
  id: string
  tenantId: string
  organizationId: string
  runId: string
  agentId: string
  connectorId: string
  externalRunId?: string | null
  processId?: string | null
  stepId?: string | null
  signalName?: string | null
  expiresAt: Date
}

const CORRELATION_FIELDS = [
  'id',
  'tenantId',
  'organizationId',
  'runId',
  'agentId',
  'connectorId',
  'externalRunId',
  'processId',
  'stepId',
  'signalName',
  'expiresAt',
] as const

export type ExternalRunSweepDeps = {
  container: AwilixContainer
  commandBus: CommandBus
}

/**
 * Ask the queue to check ONE run at its deadline.
 *
 * Called by `ExternalAgentRunner` immediately after the correlation row is
 * written, with `delayMs` set to the remaining time plus the grace. Best-effort
 * BY CONTRACT, not by sloppiness: at the moment this runs the provider has
 * already accepted the call, so throwing would fail a run whose side effect is
 * live in the world and would report a lie (the call was placed). A failure here
 * degrades the guarantee from "precise" to "within one sweep interval", which is
 * exactly what the periodic half is for — and it is logged at error, because a
 * deployment where this fails consistently AND has no scheduler has no deadline
 * enforcement at all.
 */
export async function enqueueExternalRunDeadlineSweep(input: {
  externalRunRowId: string
  tenantId: string
  organizationId: string
  runId: string
  expiresAt: Date
}): Promise<void> {
  const payload: ExternalRunSweepJobPayload = {
    externalRunRowId: input.externalRunRowId,
    scope: { tenantId: input.tenantId, organizationId: input.organizationId },
  }
  const delayMs = Math.max(0, input.expiresAt.getTime() - Date.now() + EXTERNAL_RUN_EXPIRY_GRACE_MS)
  try {
    const queue = getAgentOrchestratorQueue(AGENT_ORCHESTRATOR_EXTERNAL_RUN_SWEEP_QUEUE)
    await queue.enqueue(payload as unknown as Record<string, unknown>, { delayMs })
  } catch (error) {
    logger.error(
      'could not enqueue the external run deadline job; the periodic sweep is now the only backstop',
      {
        externalRunRowId: input.externalRunRowId,
        runId: input.runId,
        expiresAt: input.expiresAt.toISOString(),
        error: error instanceof Error ? error.message : String(error),
      },
    )
  }
}

/**
 * The queue worker's entry point: dispatch on which arm enqueued the job.
 *
 * Both arms are idempotent, which the queue contract requires of every worker
 * (`packages/queue/AGENTS.md`) and at-least-once delivery makes unavoidable: a
 * redelivered job re-reads the row, finds it no longer `pending`, and stops —
 * and even if it did not, the claim would refuse it.
 */
export async function runExternalRunSweepJob(
  deps: ExternalRunSweepDeps,
  payload: ExternalRunSweepJobPayload,
): Promise<void> {
  const scope = payload?.scope
  if (!scope?.tenantId || !scope?.organizationId) {
    logger.warn('external run sweep job carried no tenancy; ignoring')
    return
  }
  if (payload.externalRunRowId) {
    await expireOneExternalRun(deps, payload.externalRunRowId, scope)
    return
  }
  await sweepExpiredExternalRuns(deps, scope)
}

/**
 * The TARGETED arm: one row, addressed by the delayed job the runner enqueued.
 *
 * The read is scoped by tenant AND organization in SQL, so a job payload naming
 * another tenant's row id resolves nothing — and the scope handed to the
 * settlement is then read back off the ROW, never off the payload, so
 * `scope_denied` is structurally unreachable rather than merely unlikely.
 */
async function expireOneExternalRun(
  deps: ExternalRunSweepDeps,
  externalRunRowId: string,
  scope: ExternalAgentConnectorScope,
): Promise<void> {
  const em = (deps.container.resolve('em') as EntityManager).fork()
  const rows = await findWithDecryption(
    em,
    AgentExternalRun,
    {
      id: externalRunRowId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      // The status filter is what makes the common case — the provider answered
      // on time, as it usually does — cost one indexed read and nothing else. It
      // is an optimisation, NOT the safety property: the row could still flip
      // between this SELECT and the claim below, and the claim's own
      // `status = 'pending'` predicate is what refuses that.
      status: 'pending',
    },
    { fields: [...CORRELATION_FIELDS], limit: 1 },
  )
  const row = rows[0] as ExpirableExternalRun | undefined
  if (!row) return

  // A deadline job can outrace its own deadline by a few milliseconds (queue
  // wake-up jitter, a clock that moved). Re-check rather than trusting the delay:
  // expiring a run whose deadline has not passed would hang up on a live call.
  if (row.expiresAt.getTime() > Date.now()) {
    logger.info('external run deadline job fired early; leaving the run pending', {
      externalRunRowId: row.id,
      runId: row.runId,
      expiresAt: row.expiresAt.toISOString(),
    })
    return
  }

  await expireExternalRun(deps, row)
}

/**
 * The PERIODIC arm: every `pending` row in one organization whose deadline has
 * passed.
 *
 * Rides the `(organization_id, status, expires_at)` index T2.1 built for it, in
 * that column order. Scoped by tenant as well as organization — the index leads
 * on `organization_id`, but a sweep must never be able to reach another tenant's
 * rows even if two organizations somehow shared an id.
 */
export async function sweepExpiredExternalRuns(
  deps: ExternalRunSweepDeps,
  scope: ExternalAgentConnectorScope,
): Promise<{ expired: number; scanned: number }> {
  const em = (deps.container.resolve('em') as EntityManager).fork()
  const cutoff = new Date(Date.now() - EXTERNAL_RUN_EXPIRY_GRACE_MS)
  const rows = (await findWithDecryption(
    em,
    AgentExternalRun,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      status: 'pending',
      expiresAt: { $lte: cutoff },
    },
    { fields: [...CORRELATION_FIELDS], orderBy: { expiresAt: 'ASC' }, limit: SWEEP_BATCH_LIMIT },
  )) as unknown as ExpirableExternalRun[]

  let expired = 0
  for (const row of rows) {
    // Sequential, and one failure never stops the sweep: these rows are
    // independent workflows, and letting a signal failure on one abandon the
    // rest would reproduce R2 for every row behind it in the batch.
    try {
      const settled = await expireExternalRun(deps, row)
      if (settled.status === 'failed') expired += 1
    } catch (error) {
      logger.error('external run expiry threw; continuing with the rest of the batch', {
        externalRunRowId: row.id,
        runId: row.runId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (rows.length > 0) {
    logger.info('expired external runs past their callback deadline', {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      scanned: rows.length,
      expired,
      // A full batch means there is more waiting; the next tick continues.
      batchFull: rows.length === SWEEP_BATCH_LIMIT,
    })
  }

  return { expired, scanned: rows.length }
}

/**
 * Expire one row: settle the run as failed down the `error` handle, wake the
 * parked step, then hang up.
 *
 * ORDER IS THE DECISION HERE. Cancellation runs LAST, after
 * `completeExternalRun` has claimed the row and resumed the workflow, for two
 * reasons that point the same way:
 *
 *   1. **Only the claim winner may cancel.** If a callback beat us, the run is
 *      legitimately settled with a real answer — hanging up on the provider's
 *      resource at that point is at best pointless and at worst destructive.
 *      Claiming first and cancelling only on a `failed` result makes that
 *      impossible; cancelling first could not.
 *   2. **A slow or dead provider must not delay the resume.** The most likely
 *      reason we are here at all is that the provider is unreachable, so its
 *      `cancel` is the call most likely to hang. Freeing the workflow first costs
 *      the extra hang-up a few hundred milliseconds and buys immunity from that.
 */
export async function expireExternalRun(
  deps: ExternalRunSweepDeps,
  row: ExpirableExternalRun,
): Promise<CompleteExternalRunResult> {
  const scope = { tenantId: row.tenantId, organizationId: row.organizationId }
  const settled = await completeExternalRun({
    container: deps.container,
    commandBus: deps.commandBus,
    row: {
      id: row.id,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      runId: row.runId,
      agentId: row.agentId,
      connectorId: row.connectorId,
      processId: row.processId ?? null,
      stepId: row.stepId ?? null,
      signalName: row.signalName ?? null,
    },
    scope,
    settlement: {
      kind: 'expired',
      reason: `no callback arrived before the deadline at ${row.expiresAt.toISOString()}`,
    },
  })

  if (settled.status !== 'failed') {
    // `already_settled` is the normal race outcome — the provider answered while
    // the deadline job was in flight — and it means we must touch nothing,
    // including the provider. Anything else here (`completed`, `scope_denied`)
    // cannot be produced by an `expired` settlement of a row we just read under
    // its own scope, so it is worth a line if it ever appears.
    logger.info('external run was already settled when its deadline fired; nothing expired', {
      externalRunRowId: row.id,
      runId: row.runId,
      settlementStatus: settled.status,
    })
    return settled
  }

  logger.warn('external run expired: no callback arrived before its deadline', {
    externalRunRowId: row.id,
    runId: row.runId,
    agentId: row.agentId,
    connectorId: row.connectorId,
    externalRunId: row.externalRunId ?? null,
    expiresAt: row.expiresAt.toISOString(),
    processId: row.processId ?? null,
    stepId: row.stepId ?? null,
    // Whether the parked step actually woke is the fact R2 is about, so it goes
    // in the same line as the expiry rather than only in `completeExternalRun`'s.
    resume: settled.resume,
  })

  await cancelExternalWork(row, scope)
  return settled
}

/**
 * Best-effort hang-up. Never throws, never blocks the expiry.
 *
 * The three ways this does nothing are all logged differently on purpose, because
 * they mean different things to whoever reads the log after a bill arrives:
 * a connector with no `cancel` chose to let the provider finish (benign, and the
 * documented default in T2.2's interface); a row with no provider id means
 * `start()` never told us what to cancel; a `cancel` that THREW may well mean a
 * call is still live, still costing money, and now attributed to nothing — which
 * is why that arm is the only one at `error`.
 */
async function cancelExternalWork(
  row: ExpirableExternalRun,
  scope: ExternalAgentConnectorScope,
): Promise<void> {
  const connector = getExternalAgentConnector(row.connectorId)
  if (!connector) {
    logger.warn('expired external run could not be cancelled; no connector is registered', {
      externalRunRowId: row.id,
      runId: row.runId,
      connectorId: row.connectorId,
    })
    return
  }
  if (!connector.cancel) {
    logger.info('expired external run left to finish on its own; the connector implements no cancel', {
      externalRunRowId: row.id,
      runId: row.runId,
      connectorId: row.connectorId,
    })
    return
  }
  if (!row.externalRunId) {
    logger.warn('expired external run has no provider id to cancel', {
      externalRunRowId: row.id,
      runId: row.runId,
      connectorId: row.connectorId,
    })
    return
  }

  try {
    await connector.cancel(row.externalRunId, scope)
    logger.info('cancelled the external work behind an expired run', {
      externalRunRowId: row.id,
      runId: row.runId,
      connectorId: row.connectorId,
      externalRunId: row.externalRunId,
    })
  } catch (error) {
    logger.error(
      'failed to cancel the external work behind an expired run; it may still be running and is now unattributed',
      {
        externalRunRowId: row.id,
        runId: row.runId,
        connectorId: row.connectorId,
        externalRunId: row.externalRunId,
        error: error instanceof Error ? error.message : String(error),
      },
    )
  }
}
