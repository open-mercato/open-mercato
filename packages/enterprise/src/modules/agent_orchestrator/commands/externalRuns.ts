import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { AgentExternalRun } from '../data/entities'
import {
  agentExternalRunSchema,
  claimAgentExternalRunSchema,
  settleAgentExternalRunSchema,
  type ClaimAgentExternalRunInput,
  type SettleAgentExternalRunInput,
} from '../data/validators'

/**
 * The correlation row that links a suspended `AgentRun` to the external provider
 * answering it later (external-agent-invocation design §5.5).
 *
 * It is written through a Command rather than a raw `em.flush()` for a reason
 * that is enforced at runtime, not merely stylistic: an `INVOKE_AGENT` run bound
 * to a provisioned agent principal executes inside `withAgentActor`, and
 * `AgentKindNoBypassSubscriber` throws on ANY flush under that scope that is not
 * nested in `withAuditedCommand`. Its own docstring names "the token-bearing
 * external case" as the case it exists for. A raw write here would therefore fail
 * closed at flush time for exactly the agents this table is built for.
 */
const createAgentExternalRunSchema = z.intersection(
  z.object({
    tenantId: z.string().uuid(),
    organizationId: z.string().uuid(),
  }),
  agentExternalRunSchema,
)
export type CreateAgentExternalRunInput = z.infer<typeof createAgentExternalRunSchema>

export const createAgentExternalRunCommand: CommandHandler<
  CreateAgentExternalRunInput,
  { externalRunRowId: string }
> = {
  id: 'agent_orchestrator.external_runs.create',
  async execute(rawInput, ctx) {
    const input = createAgentExternalRunSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const row = em.create(AgentExternalRun, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      runId: input.runId,
      agentId: input.agentId,
      connectorId: input.connectorId,
      // Only the digest — `agentExternalRunSchema` rejects anything that is not a
      // lowercase SHA-256 hex string, so the plaintext bearer cannot land here by
      // accident and a dump of this table yields no forgeable callback.
      callbackTokenHash: input.callbackTokenHash,
      externalRunId: input.externalRunId ?? null,
      processId: input.processId ?? null,
      stepId: input.stepId ?? null,
      signalName: input.signalName ?? null,
      status: input.status,
      expiresAt: input.expiresAt,
      requestPayload: input.requestPayload ?? null,
      resultPayload: input.resultPayload ?? null,
      failureReason: input.failureReason ?? null,
    })
    em.persist(row)
    await em.flush()
    return { externalRunRowId: row.id }
  },
}

/**
 * Claim a `pending` correlation row (design §5.5 "single-shot completion").
 *
 * This is THE idempotency point of the whole external seam. A provider that
 * redelivers its webhook — ElevenLabs retries a non-2xx post-call callback, and
 * any at-least-once transport eventually double-delivers — must not resume the
 * parked workflow step twice, because the second resume would advance the run
 * again from a step it already left. Guarding the transition on `status =
 * 'pending'` in the WHERE clause makes the database, not application ordering,
 * decide which delivery wins: the loser updates zero rows and is told so.
 *
 * A targeted `nativeUpdate` rather than a managed write, for the same reason
 * `closeAgentDispositionTask` (workflows) and `dispositionService`'s auto-approve
 * stamp use one: a read-then-write through the identity map is two statements
 * with a race between them, and MikroORM offers no conditional flush. The tenancy
 * columns are part of the predicate, so a caller holding the wrong scope claims
 * nothing even if it somehow knows the row id.
 *
 * `updatedAt` is set explicitly because `nativeUpdate` bypasses the `onUpdate`
 * hook — without it the row's optimistic-lock token would not move when its
 * status did.
 */
export const claimAgentExternalRunCommand: CommandHandler<
  ClaimAgentExternalRunInput,
  { claimed: boolean }
> = {
  id: 'agent_orchestrator.external_runs.claim',
  async execute(rawInput, ctx) {
    const input = claimAgentExternalRunSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const affected = await em.nativeUpdate(
      AgentExternalRun,
      {
        id: input.externalRunRowId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        status: 'pending',
      },
      { status: input.status, updatedAt: new Date() },
    )
    return { claimed: affected > 0 }
  },
}

/**
 * Record what the settlement produced on an already-claimed row.
 *
 * A MANAGED write, deliberately: `result_payload`, `request_payload` and
 * `failure_reason` are declared in this module's `defaultEncryptionMaps`, and the
 * encryption subscriber encrypts through the ORM's `beforeUpdate` hook — which a
 * `nativeUpdate` skips entirely. Writing a normalized call transcript with native
 * SQL would therefore store, in plaintext, free text spoken by a real person
 * about a real person: the single most sensitive column this module owns.
 *
 * It also carries the FINAL status, which may differ from the one the claim
 * provisionally wrote: a result-bearing callback claims `completed` before its
 * payload has been validated or screened, so a schema-invalid or guardrail-blocked
 * payload is corrected to `failed` here. The claim's job is to win the race; this
 * write's job is to tell the truth about what happened.
 */
export const settleAgentExternalRunCommand: CommandHandler<
  SettleAgentExternalRunInput,
  { settled: boolean }
> = {
  id: 'agent_orchestrator.external_runs.settle',
  async execute(rawInput, ctx) {
    const input = settleAgentExternalRunSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const row = await em.findOne(AgentExternalRun, {
      id: input.externalRunRowId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
    if (!row) return { settled: false }
    row.status = input.status
    if (input.resultPayload !== undefined) row.resultPayload = input.resultPayload
    if (input.failureReason !== undefined) row.failureReason = input.failureReason
    row.updatedAt = new Date()
    await em.flush()
    return { settled: true }
  },
}

registerCommand(createAgentExternalRunCommand)
registerCommand(claimAgentExternalRunCommand)
registerCommand(settleAgentExternalRunCommand)
