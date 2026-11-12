import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { AgentEvalCase, AgentEvalSuiteRun } from '../../data/entities'
import { replaySuiteRun } from './evalReplayService'
import type {
  CompleteEvalRunCommandInput,
  CompleteEvalRunCommandResult,
  StartEvalRunCommandInput,
  StartEvalRunCommandResult,
} from '../../commands/evalRuns'

export type EvalGateInput = {
  agentDefinitionId: string
  /** Stamped onto the suite run; the caller owns release identity. */
  releaseId?: string | null
  /**
   * Pins the dataset snapshot. Omitted ⇒ the run is ADVISORY: without a pinned
   * dataset a verdict is not reproducible, so it must not read as a gate result.
   */
  evalSetVersion?: string | null
  /** Overrides automatic baseline selection (previous completed run for this agent). */
  baselineSuiteRunId?: string | null
  repeatCount?: number
  scope: { tenantId: string; organizationId: string }
  /** `'ci'` or a userId, recorded on the suite run. */
  triggeredBy?: string | null
}

export type EvalGateResult = {
  suiteRunId: string
  passScore: number | null
  /** Assertion keys that regressed vs the baseline. Non-empty ⇒ the caller MUST block. */
  safetyRegressions: string[]
  outcome: 'passed' | 'failed' | 'advisory'
  caseRunCount: number
  errorCount: number
  baselineSuiteRunId: string | null
}

/**
 * The eval plane's single entry point for a regression gate.
 *
 * `EvalGateRunner` (lifecycle spec) calls this and compares `passScore` against
 * its own `evalGate.requiredPassScore`. The division of labour is deliberate:
 * this function owns *what the evidence says*, the caller owns *what policy to
 * apply on top*. It therefore applies NO absolute threshold of its own —
 * hardcoding one here would make every configured `requiredPassScore` below it
 * dead, and would fail a 99%-passing suite.
 *
 * **`outcome` is authoritative.** A caller MUST NOT promote on `'failed'`; its
 * own threshold may only narrow the verdict further, never widen it.
 *
 * Runs with `judgeMayGate: false`: a judge verdict is stochastic, so it is
 * reported but can never move a promotion decision.
 */
export async function runEvalGate(
  container: AwilixContainer,
  input: EvalGateInput,
): Promise<EvalGateResult> {
  const em = (container.resolve('em') as EntityManager).fork()
  const commandBus = container.resolve('commandBus') as CommandBus
  const scope = input.scope
  const triggeredBy = input.triggeredBy ?? 'ci'

  // Only APPROVED cases form the regression set — a draft has not been reviewed,
  // so its expected value cannot serve as a baseline for blocking a release.
  const cases = await em.find(AgentEvalCase, {
    ...scope,
    agentDefinitionId: input.agentDefinitionId,
    status: 'approved',
    deletedAt: null,
  })
  if (!cases.length) {
    throw new Error(
      `[internal] no approved eval cases for agent "${input.agentDefinitionId}" — nothing to gate on`,
    )
  }

  const commandCtx: CommandRuntimeContext = {
    container,
    auth: { sub: triggeredBy, tenantId: scope.tenantId, orgId: scope.organizationId } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    request: undefined,
  }

  const { result: started } = await commandBus.execute<StartEvalRunCommandInput, StartEvalRunCommandResult>(
    'agent_orchestrator.evalRuns.start',
    {
      input: {
        ...scope,
        agentDefinitionId: input.agentDefinitionId,
        evalCaseIds: cases.map((entry) => entry.id),
        repeatCount: input.repeatCount ?? 1,
        trigger: 'ci',
        // CI never lets a judge gate — see the doc comment.
        judgeMayGate: false,
        releaseId: input.releaseId ?? null,
        evalSetVersion: input.evalSetVersion ?? null,
        triggeredBy,
      },
      ctx: commandCtx,
    },
  )

  // An explicit baseline overrides automatic selection, so a caller can pin the
  // comparison to the currently-active release rather than to whatever ran last.
  if (input.baselineSuiteRunId) {
    const suiteRun = await em.findOne(AgentEvalSuiteRun, { id: started.suiteRunId, ...scope })
    if (suiteRun) {
      suiteRun.baselineSuiteRunId = input.baselineSuiteRunId
      await em.flush()
    }
  }

  await replaySuiteRun(container, started.suiteRunId, scope, triggeredBy)

  const { result: completed } = await commandBus.execute<
    CompleteEvalRunCommandInput,
    CompleteEvalRunCommandResult
  >('agent_orchestrator.evalRuns.complete', {
    input: { ...scope, suiteRunId: started.suiteRunId },
    ctx: commandCtx,
  })

  const finished = await em.findOne(AgentEvalSuiteRun, { id: started.suiteRunId, ...scope })

  return {
    suiteRunId: started.suiteRunId,
    passScore: completed.passScore,
    safetyRegressions: completed.safetyRegressions ?? [],
    outcome: (completed.outcome ?? 'advisory') as EvalGateResult['outcome'],
    caseRunCount: started.caseRunCount,
    errorCount: finished?.errorCount ?? 0,
    baselineSuiteRunId: completed.baselineSuiteRunId ?? null,
  }
}
