import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { AgentProposal, AgentRun, AgentSpan, AgentToolCall } from '../../../data/entities'
import { projectRunView } from '../../../lib/eval/projectRunView'
import { getScorerDefinition, parseScorerConfig, runScorer } from '../../../lib/eval/registry'
import { createModelJudge } from '../../../lib/eval/llmJudge'
import { normalizeJudgeRubric } from '../../../lib/eval/judgeRubric'
import type { Json } from '../../../lib/eval/types'
import { agentOrchestratorTag } from '../../openapi'

/**
 * Dry-runs an assertion against a REAL historical run, without persisting
 * anything.
 *
 * This is the highest-value authoring affordance in the surveyed field (Langfuse
 * ships the same idea): an author can see what a rubric or threshold actually does
 * to real output BEFORE saving it, instead of discovering it on the next
 * production run. Nothing here writes — no `AgentEvalResult`, no counters.
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] },
}

const previewSchema = z.object({
  scorerKey: z.string().min(1).max(100),
  config: z.unknown().optional(),
  runId: z.string().uuid(),
  /** Stands in for an eval case's expected value when previewing a comparison scorer. */
  expected: z.unknown().optional(),
})

const errorSchema = z.object({ error: z.string() })

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId) return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })

  const parsed = previewSchema.safeParse(await readJsonSafe<unknown>(req, {}))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }
  const input = parsed.data

  const definition = getScorerDefinition(input.scorerKey)
  if (!definition) {
    return NextResponse.json({ error: '[internal] unknown scorer', scorerKey: input.scorerKey }, { status: 422 })
  }

  // Validate with the WRITE schema: the preview should reject exactly what saving
  // would reject, otherwise it would green-light a config the form then refuses.
  const configCheck = parseScorerConfig(input.scorerKey, input.config, 'write')
  if (!configCheck.ok) {
    return NextResponse.json(
      { error: '[internal] invalid assertion configuration', issues: configCheck.issues },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const run = await findOneWithDecryption(em, AgentRun, { id: input.runId, ...scope }, undefined, scope)
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const toolCalls = await findWithDecryption(em, AgentToolCall, { agentRunId: run.id, ...scope }, undefined, scope)
  const spans = await em.find(AgentSpan, { agentRunId: run.id, ...scope })
  const proposal = await em.findOne(AgentProposal, { runId: run.id, ...scope })
  const runView = projectRunView({ run, toolCalls, spans, disposition: proposal?.disposition ?? null })

  const expected = (input.expected ?? null) as Json | null

  if (definition.kind === 'llm_judge') {
    const rubric = normalizeJudgeRubric(input.config, '')
    if (!rubric) {
      return NextResponse.json({ error: '[internal] rubric is required to preview a judge' }, { status: 422 })
    }
    try {
      const verdict = await createModelJudge(container)({ rubric, runOutput: run.output, expected })
      return NextResponse.json({ ...verdict, scorerKey: input.scorerKey, runId: run.id })
    } catch (error) {
      // No provider configured, or the model refused: a preview failure is
      // informational, never a 500 that looks like a platform fault.
      return NextResponse.json(
        {
          error: '[internal] judge preview unavailable',
          detail: error instanceof Error ? error.message : String(error),
        },
        { status: 422 },
      )
    }
  }

  const verdict = runScorer(input.scorerKey, runView, expected, input.config)
  return NextResponse.json({ ...verdict, scorerKey: input.scorerKey, runId: run.id })
}

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Preview an assertion against an existing run',
  methods: {
    POST: {
      summary: 'Dry-run a scorer or judge rubric against a real historical run',
      description:
        'Scores an existing AgentRun with the supplied scorerKey + config and returns the verdict WITHOUT persisting anything. `passed: null` means the assertion would be skipped. Config is validated with the same rules as saving, so a preview cannot green-light a config the form would reject. Judge previews resolve a model and therefore cost a round-trip; they return 422 (not 500) when no provider is configured. Gated by agent_orchestrator.eval.manage.',
      responses: [{ status: 200, description: 'The verdict this assertion would produce' }],
      errors: [
        { status: 400, description: 'Invalid body', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.eval.manage', schema: errorSchema },
        { status: 404, description: 'Run not found (or cross-tenant)', schema: errorSchema },
        { status: 422, description: 'Unknown scorer, invalid config, or judge unavailable', schema: errorSchema },
      ],
    },
  },
}
