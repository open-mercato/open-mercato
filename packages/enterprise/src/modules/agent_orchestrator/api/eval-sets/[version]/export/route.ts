import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  EVAL_SET_EXPORT_CURRENT,
  EVAL_SET_SNAPSHOT_LATEST,
  evalSetExportQuerySchema,
  evalSetExportVersionSchema,
} from '../../../../data/validators'
import { manifestFromFile } from '../../../../lib/eval/evalSetFile'
import { EVAL_SET_EXPORT_FEATURES, hasEvalSetFeatures } from '../../../../lib/eval/evalSetAccess'
import { evalSetFileForExport } from '../../../../lib/eval/evalSetFileIo'
import { stringifyEvalSetFile, type EvalSetTextFormat } from '../../../../lib/eval/evalSetYaml'
import { EvalSetTooLargeError, EvalSetUnresolvedError, resolveSnapshotPin } from '../../../../lib/eval/manifest'
import { collectRubricRefs, ensureRubricLibrary } from '../../../../lib/eval/rubrics'
import { agentOrchestratorTag } from '../../../openapi'

/**
 * Downloads an eval set as an `open-mercato.agent-eval-set` file: `current`
 * freezes the agent's approved cases on the fly (not persisted), `sha256:<hex>`
 * loads a manifest frozen by an earlier run. The file is what `--cases` and
 * POST /eval-sets/import accept. llm_judge assertions stored as `gate` are
 * exported as `warn` (the file format refuses a judge gate); their keys are
 * listed in the `x-om-eval-set-downgraded` header.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: [...EVAL_SET_EXPORT_FEATURES] },
}

export const EVAL_SET_VERSION_HEADER = 'x-om-eval-set-version'
export const EVAL_SET_SOURCE_VERSION_HEADER = 'x-om-eval-set-source-version'
export const EVAL_SET_DOWNGRADED_HEADER = 'x-om-eval-set-downgraded'

const FORMAT_OUTPUT: Record<EvalSetTextFormat, { contentType: string; extension: string }> = {
  json: { contentType: 'application/json; charset=utf-8', extension: 'json' },
  yaml: { contentType: 'application/yaml; charset=utf-8', extension: 'yaml' },
}

const errorSchema = z.object({ error: z.string() })
const issueSchema = z.object({ code: z.string(), path: z.string(), message: z.string() })
const invalidExportSchema = z.object({
  error: z.string(),
  code: z.string(),
  issues: z.array(issueSchema),
  downgradedAssertions: z.array(z.string()),
})

type RouteContext = { params: Promise<{ version: string }> }

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function filenameFor(agentId: string, version: string, extension: string): string {
  const agent = agentId.replace(/[^A-Za-z0-9._-]+/g, '_')
  const suffix = version.startsWith('sha256:') ? version.slice('sha256:'.length, 'sha256:'.length + 12) : version
  return `eval-set-${agent}-${suffix}.${extension}`
}

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId) return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const { version: rawVersion } = await ctx.params
  const version = evalSetExportVersionSchema.safeParse(decodeParam(rawVersion))
  if (!version.success) return NextResponse.json({ error: 'Invalid eval set version' }, { status: 400 })
  const url = new URL(req.url)
  const query = evalSetExportQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!query.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
  const { agentDefinitionId, format } = query.data

  const container = await createRequestContainer()
  if (!(await hasEvalSetFeatures(container, auth, scope, EVAL_SET_EXPORT_FEATURES))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const em = (container.resolve('em') as EntityManager).fork()
  const snapshot = version.data === EVAL_SET_EXPORT_CURRENT ? EVAL_SET_SNAPSHOT_LATEST : version.data
  let pinned: Awaited<ReturnType<typeof resolveSnapshotPin>>
  try {
    pinned = await resolveSnapshotPin(em, scope, agentDefinitionId, snapshot)
  } catch (err) {
    if (err instanceof EvalSetUnresolvedError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (err instanceof EvalSetTooLargeError) {
      return NextResponse.json({ error: err.code, code: err.code, issues: [], downgradedAssertions: [] }, { status: 422 })
    }
    throw err
  }

  await ensureRubricLibrary(collectRubricRefs(pinned.manifest.assertions.map((assertion) => assertion.config)))
  const exported = evalSetFileForExport(pinned.manifest)
  if (!exported.ok) {
    return NextResponse.json(
      {
        error: 'eval_set_not_exportable',
        code: 'eval_set_not_exportable',
        issues: exported.issues,
        downgradedAssertions: exported.downgradedKeys,
      },
      { status: 422 },
    )
  }

  const output = FORMAT_OUTPUT[format]
  const headers = new Headers({
    'Content-Type': output.contentType,
    'Content-Disposition': `attachment; filename="${filenameFor(agentDefinitionId, version.data, output.extension)}"`,
    'Cache-Control': 'no-store',
    [EVAL_SET_VERSION_HEADER]: manifestFromFile(exported.file).version,
    [EVAL_SET_SOURCE_VERSION_HEADER]: pinned.version,
  })
  if (exported.downgradedKeys.length > 0) {
    headers.set(EVAL_SET_DOWNGRADED_HEADER, exported.downgradedKeys.map((key) => encodeURIComponent(key)).join(','))
  }
  return new NextResponse(stringifyEvalSetFile(exported.file, format), { status: 200, headers })
}

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Export an agent eval set as a file',
  methods: {
    GET: {
      summary: 'Download an eval set (current approved cases or a frozen manifest) as a JSON or YAML file',
      description:
        '`:version` is `current` (the agent\'s approved cases and enabled assertions, frozen on the fly and not persisted) or `sha256:<hex>` (a manifest frozen by an earlier eval run of this agent in the caller\'s organization). Query: `agentDefinitionId` (required), `format` = `json` (default) or `yaml`. The body is an `open-mercato.agent-eval-set` file that `mercato agent_orchestrator eval --cases` and POST /eval-sets/import accept. Headers: `x-om-eval-set-version` is the file\'s own manifest hash (what `--cases` pins), `x-om-eval-set-source-version` the exported manifest\'s hash, and `x-om-eval-set-downgraded` lists (URI-encoded, comma-separated) the llm_judge assertion keys stored as `gate` that were exported as `warn`. Decrypted case inputs leave the system in this file. Gated by agent_orchestrator.eval.export.',
      responses: [{ status: 200, description: 'The eval-set file as an attachment', mediaType: 'application/json' }],
      errors: [
        { status: 400, description: 'Invalid version, query, or missing tenant context', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.eval.export', schema: errorSchema },
        { status: 404, description: 'Unknown version for this agent in the caller\'s organization', schema: errorSchema },
        {
          status: 422,
          description: 'The eval set is above OM_AGENT_EVAL_SET_MAX_BYTES or cannot be written as a valid file (e.g. an assertion with an unknown scorer)',
          schema: invalidExportSchema,
        },
      ],
    },
  },
}
