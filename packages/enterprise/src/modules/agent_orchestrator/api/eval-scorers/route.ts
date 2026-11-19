import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { describeScorers } from '../../lib/eval/registry'
import { ensureAgentRubricsLoaded, listRubrics } from '../../lib/eval/rubrics'
import { agentOrchestratorTag } from '../openapi'

/**
 * Projection of the scorer registry that DRIVES the generated assertion form.
 *
 * The backend page used to import the registry module directly, which shipped
 * every scorer's zod schema, `score` body and PII regexes to the browser. Serving
 * the descriptors instead keeps the registry server-side and the client bundle
 * flat, and gives third parties a stable contract for the catalog.
 *
 * The payload is a projection of CODE, not of tenant data, so it is identical for
 * every caller and is cached for the process lifetime — a deploy replaces the
 * process, so there is no invalidation path to get wrong.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] },
}

const errorSchema = z.object({ error: z.string() })

let cachedScorers: ReturnType<typeof describeScorers> | null = null

const querySchema = z.object({ agentDefinitionId: z.string().min(1).max(100).optional() })

/**
 * `rubrics` lists the judge rubrics a `{ rubricRef }` config can name: the
 * agent's own (`source: 'agent'`) when `agentDefinitionId` is given, then the
 * built-ins it does not shadow. Code-defined, so no tenant data is involved.
 */
export async function GET(req: Request) {
  if (!cachedScorers) cachedScorers = describeScorers()
  const url = new URL(req.url)
  const query = querySchema.safeParse({ agentDefinitionId: url.searchParams.get('agentDefinitionId') ?? undefined })
  const agentId = query.success ? query.data.agentDefinitionId ?? null : null
  if (agentId) await ensureAgentRubricsLoaded()
  return NextResponse.json({ scorers: cachedScorers, rubrics: listRubrics(agentId) })
}

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'List available eval scorers',
  methods: {
    GET: {
      summary: 'Scorer registry descriptors used to render the evaluation-assertion form',
      description:
        'Optional query `agentDefinitionId` adds that agent\'s own judge rubrics to `rubrics`. ' +
        'Returns every registered scorer as { scorerKey, labelKey, group, kind, fields[] }. `fields[]` is UI ' +
        'metadata (kind, label key, bounds, options) from which the assertion form is generated, so a new ' +
        'scorer becomes configurable without a UI change. `kind` maps to the assertion `type` column: only ' +
        '`deterministic` scorers may back a `gate`-severity assertion. Deprecated aliases are included and ' +
        'flagged with `deprecated: true` plus `deprecatedInFavourOf`. `rubrics` is the judge rubric library as ' +
        '{ key, title, titleKey?, source: builtin|agent }: the keys an llm_judge `{ rubricRef }` config may name ' +
        '(agent rubrics shadow built-ins of the same key). Gated by agent_orchestrator.eval.manage.',
      responses: [{ status: 200, description: 'Scorer descriptors and the judge rubric library' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.eval.manage', schema: errorSchema },
      ],
    },
  },
}
