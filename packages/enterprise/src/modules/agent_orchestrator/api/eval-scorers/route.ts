import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { describeScorers } from '../../lib/eval/registry'
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

let cached: { scorers: ReturnType<typeof describeScorers> } | null = null

export async function GET() {
  if (!cached) cached = { scorers: describeScorers() }
  return NextResponse.json(cached)
}

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'List available eval scorers',
  methods: {
    GET: {
      summary: 'Scorer registry descriptors used to render the evaluation-assertion form',
      description:
        'Returns every registered scorer as { scorerKey, labelKey, group, kind, fields[] }. `fields[]` is UI ' +
        'metadata (kind, label key, bounds, options) from which the assertion form is generated, so a new ' +
        'scorer becomes configurable without a UI change. `kind` maps to the assertion `type` column: only ' +
        '`deterministic` scorers may back a `gate`-severity assertion. Deprecated aliases are included and ' +
        'flagged with `deprecated: true` plus `deprecatedInFavourOf`. Gated by agent_orchestrator.eval.manage.',
      responses: [{ status: 200, description: 'Scorer descriptors' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.eval.manage', schema: errorSchema },
      ],
    },
  },
}
