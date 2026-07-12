import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { traceIngestSchema } from '../data/validators'
import { ingestTrace, type IngestTraceResult } from '../lib/trace/traceIngestionService'
import { createArtifactOffloader } from '../lib/trace/artifactStore'
import { evaluateRun } from '../lib/eval/evalRuntimeService'
import { resolveJudgeSampleRate, shouldSampleForJudge } from '../lib/eval/sampling'
import { AgentEvalAssertion, AgentRun } from '../data/entities'
import { AGENT_ORCHESTRATOR_LLM_JUDGE_QUEUE, getAgentOrchestratorQueue } from '../lib/queue'
import { emitAgentOrchestratorEvent } from '../events'

const ingestTraceCommandSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  payload: traceIngestSchema,
})
export type IngestTraceCommandInput = z.infer<typeof ingestTraceCommandSchema>

/**
 * Audited write path for trace ingestion. The HMAC route resolves the verified
 * tenant/org scope and hands the parsed payload here; the service performs the
 * idempotent upsert + append, and we emit `run.ingested` once per call.
 */
const ingestTraceCommand: CommandHandler<IngestTraceCommandInput, IngestTraceResult> = {
  id: 'agent_orchestrator.trace.ingest',
  async execute(rawInput, ctx) {
    const input = ingestTraceCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const result = await ingestTrace(em, scope, input.payload, {
      offloadArtifact: createArtifactOffloader(ctx.container, scope),
    })

    // Inline deterministic evaluation (gate tier). Reuses the same EM; `warn`
    // results never block, a failing `gate` marks the run evalPassed = false.
    const evalResult = await evaluateRun(em, scope, result.runId)

    // Additive (process projection spec): make run-cost rollups joinable to a
    // process. The upserted run row is the source; payload-carried processId
    // (when the trace POST includes one) was already stamped by ingestTrace.
    const ingestedRun = await em.findOne(
      AgentRun,
      { id: result.runId, ...scope },
      { fields: ['id', 'processId'] },
    )

    await emitAgentOrchestratorEvent(
      'agent_orchestrator.run.ingested',
      {
        id: result.runId,
        agentId: input.payload.agentId,
        runtime: input.payload.runtime,
        processId: ingestedRun?.processId ?? null,
        created: result.created,
        spansAppended: result.spansAppended,
        toolCallsAppended: result.toolCallsAppended,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      },
      { persistent: true },
    )

    if (evalResult.evaluated > 0) {
      await emitAgentOrchestratorEvent(
        'agent_orchestrator.run.evaluated',
        {
          id: result.runId,
          agentId: input.payload.agentId,
          evaluated: evalResult.evaluated,
          evalPassed: evalResult.evalPassed,
          evalScore: evalResult.evalScore,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
        },
        { persistent: true },
      )
    }

    // Sampled async llm_judge tier (warn-only). Enqueue only when the agent has
    // enabled llm_judge assertions and this run falls in the sample. Best-effort:
    // a queue failure must not fail ingestion.
    try {
      const judgeAssertions = await em.count(AgentEvalAssertion, {
        ...scope,
        type: 'llm_judge',
        enabled: true,
        deletedAt: null,
        appliesTo: { $in: [input.payload.agentId, '*'] },
      })
      if (judgeAssertions > 0 && shouldSampleForJudge(result.runId, resolveJudgeSampleRate())) {
        await getAgentOrchestratorQueue(AGENT_ORCHESTRATOR_LLM_JUDGE_QUEUE).enqueue({ runId: result.runId, scope })
      }
    } catch (error) {
      console.warn('[internal] agent_orchestrator: failed to enqueue llm_judge job', error)
    }

    return result
  },
}

registerCommand(ingestTraceCommand)
