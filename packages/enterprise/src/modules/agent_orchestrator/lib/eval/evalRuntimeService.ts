import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentRun, AgentEvalAssertion, AgentEvalResult } from '../../data/entities'
import { getScorer } from './scorers'

export type EvaluateRunScope = { tenantId: string; organizationId: string }

export type EvaluateRunResult = {
  evaluated: number
  evalPassed: boolean | null
  evalScore: number | null
}

/**
 * Run the enabled deterministic assertions for a run inline at ingest, write an
 * `AgentEvalResult` per assertion, and stamp the run's `evalScore`/`evalPassed`.
 *
 * `evalPassed` is the AND of all `gate` results (null when no gate assertion
 * applies — the lifecycle gate reads `false` as a hard fail). `warn` results are
 * recorded but never affect `evalPassed` — they never block production. Pure over
 * the EntityManager so it is unit-testable and shares its scorers with the
 * (future) offline CI gate.
 */
export async function evaluateRun(
  em: EntityManager,
  scope: EvaluateRunScope,
  runId: string,
): Promise<EvaluateRunResult> {
  const run = await findOneWithDecryption(
    em,
    AgentRun,
    { id: runId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!run) return { evaluated: 0, evalPassed: null, evalScore: null }

  const assertions = await em.find(AgentEvalAssertion, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    type: 'deterministic',
    enabled: true,
    deletedAt: null,
    appliesTo: { $in: [run.agentId, '*'] },
  })
  if (!assertions.length) return { evaluated: 0, evalPassed: null, evalScore: null }

  const runFacts = { confidence: run.confidence ?? null, status: run.status }
  const verdicts: Array<{ severity: 'gate' | 'warn'; passed: boolean; score: number | null }> = []

  for (const assertion of assertions) {
    const config = (assertion.config as Record<string, unknown> | null) ?? {}
    const scorerKey = typeof config.scorer === 'string' ? config.scorer : assertion.key
    const scorer = getScorer(scorerKey)
    if (!scorer) continue // unknown scorer key — skip rather than fail-closed on a config typo

    const verdict = scorer({ output: run.output, run: runFacts, config })
    em.persist(
      em.create(AgentEvalResult, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        agentRunId: run.id,
        assertionId: assertion.id,
        assertionKey: assertion.key,
        passed: verdict.passed,
        score: verdict.score ?? null,
        severity: assertion.severity,
        evidence: verdict.evidence ?? null,
      }),
    )
    verdicts.push({ severity: assertion.severity, passed: verdict.passed, score: verdict.score ?? null })
  }
  await em.flush()

  const gate = verdicts.filter((v) => v.severity === 'gate')
  const evalPassed = gate.length ? gate.every((v) => v.passed) : null
  const scored = verdicts.filter((v) => typeof v.score === 'number')
  const evalScore = scored.length ? scored.reduce((sum, v) => sum + (v.score as number), 0) / scored.length : null

  run.evalScore = evalScore
  run.evalPassed = evalPassed
  await em.flush()

  return { evaluated: verdicts.length, evalPassed, evalScore }
}
