import { randomUUID } from 'node:crypto'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { AgentEvalCase, AgentEvalCaseRun, AgentEvalSuiteRun } from '../data/entities'
import { aggregateSuiteRun, compareToBaseline, resolveBaselineSuiteRun } from '../lib/eval/evalReplayService'
import { emitAgentOrchestratorEvent } from '../events'

/**
 * Ceiling on one suite run. Every case performs FRESH INFERENCE, so an unbounded
 * selection is an unbounded spend; the trigger UI shows an estimate before
 * confirming. Phase 3's worker keeps this cap and adds a concurrency lane.
 */
export const MAX_CASE_RUNS_PER_SUITE = 500

// ── evalRuns.start ──────────────────────────────────────────────────────────

const startEvalRunCommandSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  agentDefinitionId: z.string().min(1).max(100),
  evalCaseIds: z.array(z.string().uuid()).min(1),
  repeatCount: z.number().int().min(1).max(20).default(1),
  trigger: z.enum(['manual', 'ci', 'scheduled']).default('manual'),
  judgeMayGate: z.boolean().default(true),
  releaseId: z.string().uuid().nullable().optional(),
  evalSetVersion: z.string().max(100).nullable().optional(),
  triggeredBy: z.string().max(100).nullable().optional(),
})
export type StartEvalRunCommandInput = z.infer<typeof startEvalRunCommandSchema>
export type StartEvalRunCommandResult = { suiteRunId: string; caseRunCount: number }

/**
 * Creates the suite run plus one PENDING case run per (case × trial). The pending
 * rows ARE the case selection — the replay engine simply drains them, which also
 * gives per-case progress for free.
 */
const startEvalRunCommand: CommandHandler<StartEvalRunCommandInput, StartEvalRunCommandResult> = {
  id: 'agent_orchestrator.evalRuns.start',
  async execute(rawInput, ctx) {
    const input = startEvalRunCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }

    // Only approved cases are replayable: a draft has not been reviewed, so its
    // expected value cannot be trusted as a regression baseline.
    const cases = await em.find(AgentEvalCase, {
      ...scope,
      id: { $in: input.evalCaseIds },
      agentDefinitionId: input.agentDefinitionId,
      status: 'approved',
      deletedAt: null,
    })
    if (!cases.length) {
      throw new CrudHttpError(422, { error: '[internal] no approved eval cases matched for this agent' })
    }

    const caseRunCount = cases.length * input.repeatCount
    if (caseRunCount > MAX_CASE_RUNS_PER_SUITE) {
      throw new CrudHttpError(422, {
        error: '[internal] eval run exceeds the per-suite case limit',
        caseRunCount,
        limit: MAX_CASE_RUNS_PER_SUITE,
      })
    }

    // Pre-generate the PK. `id` is `defaultRaw: gen_random_uuid()`, so Postgres
    // assigns it at INSERT and it does NOT exist on the entity before flush —
    // while `withAtomicFlush` defers the flush to the end of the callback. Reading
    // `suiteRun.id` for the child rows would therefore yield `undefined` and
    // violate `suite_run_id NOT NULL`. Same pattern as `commands/runs.ts`.
    const suiteRunId = randomUUID()
    const suiteRun = em.create(AgentEvalSuiteRun, {
      id: suiteRunId,
      ...scope,
      agentDefinitionId: input.agentDefinitionId,
      releaseId: input.releaseId ?? null,
      trigger: input.trigger,
      status: 'queued',
      judgeMayGate: input.judgeMayGate,
      repeatCount: input.repeatCount,
      caseCount: caseRunCount,
      evalSetVersion: input.evalSetVersion ?? null,
      triggeredBy: input.triggeredBy ?? null,
    })

    await withAtomicFlush(
      em,
      [
        () => {
          em.persist(suiteRun)
          for (const evalCase of cases) {
            for (let trialIndex = 0; trialIndex < input.repeatCount; trialIndex += 1) {
              em.persist(
                em.create(AgentEvalCaseRun, {
                  ...scope,
                  suiteRunId,
                  evalCaseId: evalCase.id,
                  trialIndex,
                  status: 'pending',
                }),
              )
            }
          }
        },
      ],
      { transaction: true, label: 'agent_orchestrator.evalRuns.start' },
    )

    await emitAgentOrchestratorEvent(
      'agent_orchestrator.eval_suite_run.started',
      {
        id: suiteRunId,
        agentDefinitionId: suiteRun.agentDefinitionId,
        caseCount: caseRunCount,
        trigger: suiteRun.trigger,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      { persistent: true },
    )

    return { suiteRunId, caseRunCount }
  },
}

// ── evalRuns.complete ───────────────────────────────────────────────────────

const completeEvalRunCommandSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  suiteRunId: z.string().uuid(),
})
export type CompleteEvalRunCommandInput = z.infer<typeof completeEvalRunCommandSchema>
export type CompleteEvalRunCommandResult = {
  suiteRunId: string
  status: string
  outcome: string | null
  passScore: number | null
  safetyRegressions?: string[]
  baselineSuiteRunId?: string | null
}

const completeEvalRunCommand: CommandHandler<CompleteEvalRunCommandInput, CompleteEvalRunCommandResult> = {
  id: 'agent_orchestrator.evalRuns.complete',
  async execute(rawInput, ctx) {
    const input = completeEvalRunCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }

    const suiteRun = await em.findOne(AgentEvalSuiteRun, { id: input.suiteRunId, ...scope })
    if (!suiteRun) throw new CrudHttpError(404, { error: '[internal] eval suite run not found' })

    // Idempotent: completing an already-terminal run is a no-op — but it must
    // still return the fields a CI gate reads. Omitting them made
    // `result.safetyRegressions.length` throw, or fail OPEN under optional
    // chaining, for any caller that raced the worker to the same suite.
    if (suiteRun.status === 'completed' || suiteRun.status === 'cancelled') {
      return {
        suiteRunId: suiteRun.id,
        status: suiteRun.status,
        outcome: suiteRun.outcome ?? null,
        passScore: suiteRun.passScore ?? null,
        safetyRegressions: (suiteRun.safetyRegressions as string[] | null) ?? [],
        baselineSuiteRunId: suiteRun.baselineSuiteRunId ?? null,
      }
    }

    const aggregate = await aggregateSuiteRun(em, suiteRun.id, scope)

    // Regression is measured RELATIVE to the previous completed run for this agent
    // (same dataset pin, when there is one). An absolute threshold cannot tell a
    // newly-introduced failure from one that was already there.
    //
    // An explicitly pinned baseline wins over automatic selection: a gate caller
    // needs to compare against the currently-ACTIVE release, which is not
    // necessarily whatever ran most recently.
    const pinnedBaseline = suiteRun.baselineSuiteRunId
      ? await em.findOne(AgentEvalSuiteRun, { id: suiteRun.baselineSuiteRunId, ...scope })
      : null
    const baselineRun = pinnedBaseline ?? (await resolveBaselineSuiteRun(em, suiteRun, scope))
    const baselineSummary = baselineRun ? (await aggregateSuiteRun(em, baselineRun.id, scope)).summary : null
    const comparison = compareToBaseline(aggregate.summary, baselineSummary, baselineRun?.id ?? null)

    await withAtomicFlush(
      em,
      [
        () => {
          suiteRun.status = 'completed'
          suiteRun.errorCount = aggregate.errorCount
          suiteRun.passScore = aggregate.passScore
          suiteRun.scoreVariance = aggregate.scoreVariance
          suiteRun.summary = { ...aggregate.summary, __judgeDeltas: comparison.judgeDeltas }
          suiteRun.baselineSuiteRunId = comparison.baselineSuiteRunId
          suiteRun.safetyRegressions = comparison.safetyRegressions.length ? comparison.safetyRegressions : null
          suiteRun.finishedAt = new Date()
          // Spec §3.6, in order: no dataset pin => advisory; unmeasurable => failed
          // (an unmeasurable gate is a failed gate, never a pass); otherwise passed.
          // Deliberately NO absolute threshold here — `requiredPassScore` is the
          // caller's ADDITIONAL, narrower block. Hardcoding one would make every
          // configured threshold below it dead and fail a 99%-passing suite.
          // Phase 5 inserts the safety-regression check ahead of the pass branch.
          suiteRun.outcome = !suiteRun.evalSetVersion
            ? 'advisory'
            : comparison.safetyRegressions.length
              ? 'failed'
              : aggregate.passScore === null
                ? 'failed'
                : 'passed'
        },
      ],
      { transaction: true, label: 'agent_orchestrator.evalRuns.complete' },
    )

    await emitAgentOrchestratorEvent(
      'agent_orchestrator.eval_suite_run.completed',
      {
        id: suiteRun.id,
        agentDefinitionId: suiteRun.agentDefinitionId,
        outcome: suiteRun.outcome,
        passScore: suiteRun.passScore ?? null,
        errorCount: suiteRun.errorCount,
        safetyRegressions: comparison.safetyRegressions.length,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      { persistent: true },
    )

    return {
      suiteRunId: suiteRun.id,
      status: suiteRun.status,
      outcome: suiteRun.outcome ?? null,
      passScore: suiteRun.passScore ?? null,
      safetyRegressions: comparison.safetyRegressions,
      baselineSuiteRunId: comparison.baselineSuiteRunId,
    }
  },
}

// ── evalRuns.cancel ─────────────────────────────────────────────────────────

const cancelEvalRunCommandSchema = completeEvalRunCommandSchema
export type CancelEvalRunCommandInput = z.infer<typeof cancelEvalRunCommandSchema>
export type CancelEvalRunCommandResult = { suiteRunId: string; status: string }

/**
 * Terminal transition, not a delete: a suite run is an append-only >=6yr record,
 * so cancelling is the inverse of starting.
 */
const cancelEvalRunCommand: CommandHandler<CancelEvalRunCommandInput, CancelEvalRunCommandResult> = {
  id: 'agent_orchestrator.evalRuns.cancel',
  async execute(rawInput, ctx) {
    const input = cancelEvalRunCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }

    const suiteRun = await em.findOne(AgentEvalSuiteRun, { id: input.suiteRunId, ...scope })
    if (!suiteRun) throw new CrudHttpError(404, { error: '[internal] eval suite run not found' })
    if (suiteRun.status === 'completed' || suiteRun.status === 'cancelled') {
      return { suiteRunId: suiteRun.id, status: suiteRun.status }
    }

    // Pending case runs would otherwise sit unclaimed forever: the replay loop
    // stops at the next case boundary and never revisits them.
    const pending = await em.find(AgentEvalCaseRun, { suiteRunId: suiteRun.id, ...scope, status: 'pending' })

    await withAtomicFlush(
      em,
      [
        () => {
          suiteRun.status = 'cancelled'
          suiteRun.finishedAt = new Date()
          for (const caseRun of pending) caseRun.status = 'skipped'
        },
      ],
      { transaction: true, label: 'agent_orchestrator.evalRuns.cancel' },
    )

    return { suiteRunId: suiteRun.id, status: suiteRun.status }
  },
}

registerCommand(startEvalRunCommand)
registerCommand(completeEvalRunCommand)
registerCommand(cancelEvalRunCommand)

export { startEvalRunCommand, completeEvalRunCommand, cancelEvalRunCommand }
