import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { evalReportQuerySchema, type EvalReportFormat } from '../../../../data/validators'
import { buildEvalReport, EvalRunNotFinishedError } from '../../../../lib/eval/report/buildEvalReport'
import { renderEvalReportJunit } from '../../../../lib/eval/report/renderJunit'
import { renderEvalReportMarkdown } from '../../../../lib/eval/report/renderMarkdown'
import type { EvalReport } from '../../../../lib/eval/report/reportSchema'
import { agentOrchestratorTag } from '../../../openapi'

/**
 * Portable report of one suite run (JSON, Markdown or JUnit), rendered server-side
 * from the same `buildEvalReport` model the CLI writes, so no surface can drift.
 * Payloads (case inputs, agent outputs) are opt-in and covered by the same
 * `eval.export` feature as the eval-case export.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.export'] },
}

const errorSchema = z.object({ error: z.string() })
const notFinishedSchema = z.object({ error: z.literal('run_not_finished'), code: z.literal('run_not_finished') })

const FORMAT_OUTPUT: Record<EvalReportFormat, { contentType: string; extension: string }> = {
  json: { contentType: 'application/json; charset=utf-8', extension: 'json' },
  md: { contentType: 'text/markdown; charset=utf-8', extension: 'md' },
  junit: { contentType: 'application/xml; charset=utf-8', extension: 'xml' },
}

type RouteContext = { params: Promise<{ id: string }> }

function renderReport(report: EvalReport, format: EvalReportFormat): string {
  if (format === 'md') return renderEvalReportMarkdown(report)
  if (format === 'junit') return renderEvalReportJunit(report)
  return `${JSON.stringify(report, null, 2)}\n`
}

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId) return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid eval run id' }, { status: 400 })
  }

  const url = new URL(req.url)
  const parsed = evalReportQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
  const query = parsed.data

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  let report: EvalReport | null
  try {
    report = await buildEvalReport(em, scope, id, {
      includePayloads: query.includePayloads,
      partial: query.partial,
      evidenceMaxChars: query.evidenceMaxChars,
    })
  } catch (err) {
    if (err instanceof EvalRunNotFinishedError) {
      return NextResponse.json({ error: err.code, code: err.code }, { status: 409 })
    }
    throw err
  }
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const output = FORMAT_OUTPUT[query.format]
  return new NextResponse(renderReport(report, query.format), {
    status: 200,
    headers: {
      'Content-Type': output.contentType,
      'Content-Disposition': `attachment; filename="eval-${report.suiteRun.id}.${output.extension}"`,
      'Cache-Control': 'no-store',
    },
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Download an evaluation run report',
  methods: {
    GET: {
      summary: 'Portable suite run report as JSON, Markdown or JUnit',
      description:
        'Renders the versioned `open-mercato.agent-eval-report` (schemaVersion 1) for one suite run. `format` selects json (default), md or junit; the response is an attachment named `eval-<suiteRunId>.<ext>`. Case inputs and agent outputs are excluded unless `includePayloads=true`. Returns 409 `run_not_finished` while the run is queued or running unless `partial=true`, which returns the report with status `running`. Cross-tenant ids return 404. Gated by agent_orchestrator.eval.export.',
      query: evalReportQuerySchema,
      responses: [
        { status: 200, description: 'Report file (application/json, text/markdown or application/xml)' },
      ],
      errors: [
        { status: 400, description: 'Invalid id or query', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.eval.export', schema: errorSchema },
        { status: 404, description: 'Suite run not found (or cross-tenant)', schema: errorSchema },
        { status: 409, description: 'Suite run still queued or running (pass partial=true to override)', schema: notFinishedSchema },
      ],
    },
  },
}
