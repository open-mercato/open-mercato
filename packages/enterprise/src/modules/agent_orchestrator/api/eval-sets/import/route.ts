import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readBoundedRequestBody, WebhookBodyTooLargeError } from '@open-mercato/shared/lib/webhooks/body'
import { evalSetImportRequestSchema } from '../../../data/validators'
import {
  EVAL_SET_FILE_INVALID,
  EVAL_SET_RESOURCE_KIND,
  IMPORT_EVAL_SET_COMMAND_ID,
  type ImportEvalSetCommandInput,
  type ImportEvalSetCommandResult,
} from '../../../commands/evalSets'
import { EVAL_SET_FILE_ISSUE } from '../../../lib/eval/evalSetFile'
import { EVAL_SET_IMPORT_FEATURES, hasEvalSetFeatures } from '../../../lib/eval/evalSetAccess'
import { validateEvalSetText } from '../../../lib/eval/evalSetYaml'
import { resolveEvalSetMaxBytes } from '../../../lib/eval/manifest'
import { agentOrchestratorTag } from '../../openapi'

/**
 * Imports an eval-set file (JSON or YAML) into eval cases and assertions so a
 * set authored in git becomes editable in the UI. The write runs through the
 * undoable `agent_orchestrator.evalSets.import` command; re-importing the same
 * file is a no-op.
 *
 * The request body is capped at twice OM_AGENT_EVAL_SET_MAX_BYTES (413): a file
 * sent as `text` is JSON-escaped, so the transport cap leaves room for that,
 * while the file itself is still held to OM_AGENT_EVAL_SET_MAX_BYTES (422).
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: [...EVAL_SET_IMPORT_FEATURES] },
}

const EVAL_SET_IMPORT_BODY_FACTOR = 2

const errorSchema = z.object({ error: z.string() })
const issueSchema = z.object({ code: z.string(), path: z.string(), message: z.string() })
const invalidFileSchema = z.object({ error: z.string(), code: z.string(), issues: z.array(issueSchema) })
const countsSchema = z.object({ cases: z.number().int(), assertions: z.number().int() })
const changeSchema = z.enum(['created', 'updated', 'unchanged'])

const importResponseSchema = z.object({
  version: z.string(),
  agentId: z.string(),
  label: z.string().nullable(),
  created: countsSchema,
  updated: countsSchema,
  unchanged: countsSchema,
  cases: z.array(
    z.object({
      key: z.string(),
      id: z.string().uuid(),
      status: z.enum(['draft', 'approved', 'archived']),
      change: changeSchema,
    }),
  ),
  assertions: z.array(z.object({ key: z.string(), id: z.string().uuid(), change: changeSchema })),
})

function invalidFileResponse(issues: Array<z.infer<typeof issueSchema>>) {
  return NextResponse.json({ error: EVAL_SET_FILE_INVALID, code: EVAL_SET_FILE_INVALID, issues }, { status: 422 })
}

function resolveFile(input: z.infer<typeof evalSetImportRequestSchema>, maxBytes: number) {
  if (input.text === undefined) return { ok: true as const, file: input.file }
  const validation = validateEvalSetText(input.text, { format: input.format, maxBytes })
  return validation.ok ? { ok: true as const, file: validation.file } : validation
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId || !auth.sub) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  }
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const container = await createRequestContainer()
  if (!(await hasEvalSetFeatures(container, auth, scope, EVAL_SET_IMPORT_FEATURES))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const maxBytes = resolveEvalSetMaxBytes()
  let rawBody: string
  try {
    rawBody = await readBoundedRequestBody(req, { maxBytes: maxBytes * EVAL_SET_IMPORT_BODY_FACTOR })
  } catch (err) {
    if (err instanceof WebhookBodyTooLargeError) {
      return NextResponse.json(
        { error: EVAL_SET_FILE_ISSUE.tooLarge, code: EVAL_SET_FILE_ISSUE.tooLarge },
        { status: 413 },
      )
    }
    throw err
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = evalSetImportRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }
  const resolved = resolveFile(parsed.data, maxBytes)
  if (!resolved.ok) return invalidFileResponse(resolved.issues)

  const guarded = await runRouteMutationGuards({
    container,
    req,
    auth: { userId: auth.sub, tenantId: auth.tenantId, organizationId: auth.orgId },
    input: { resourceKind: EVAL_SET_RESOURCE_KIND, resourceId: auth.orgId, operation: 'custom' },
  })
  if (!guarded.ok) return guarded.response

  const commandBus = container.resolve('commandBus') as CommandBus
  const commandCtx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: null,
    selectedOrganizationId: auth.orgId,
    organizationIds: [auth.orgId],
    request: req,
  }

  try {
    const { result } = await commandBus.execute<ImportEvalSetCommandInput, ImportEvalSetCommandResult>(
      IMPORT_EVAL_SET_COMMAND_ID,
      {
        input: { ...scope, userId: auth.sub, file: resolved.file, approve: parsed.data.approve },
        ctx: commandCtx,
      },
    )
    await guarded.runAfterSuccess()
    return NextResponse.json({
      version: result.version,
      agentId: result.agentId,
      label: result.label,
      created: result.created,
      updated: result.updated,
      unchanged: result.unchanged,
      cases: result.cases,
      assertions: result.assertions,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    throw err
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Import an agent eval-set file',
  methods: {
    POST: {
      summary: 'Import an eval-set file into eval cases and assertions',
      description:
        'Materializes an `open-mercato.agent-eval-set` file (sent parsed as `file`, or as JSON/YAML `text`) into rows through the undoable agent_orchestrator.evalSets.import command. Assertions are upserted by (organization, appliesTo = agentId, key); cases are written with sourceType `file` and matched by their deterministic case id, so re-importing the same file changes nothing. A case key that is the id of one of the agent\'s existing cases (as GET /eval-sets/current/export emits) updates that case. Cases are drafts unless `approve` is true; a content change demotes an approved case unless the same import approves it. Undo soft-deletes created rows and restores overwritten ones. The file must fit OM_AGENT_EVAL_SET_MAX_BYTES; the request body may be up to twice that. Gated by agent_orchestrator.eval.manage.',
      requestBody: { contentType: 'application/json', schema: evalSetImportRequestSchema },
      responses: [{ status: 200, description: 'Import summary', schema: importResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid body or missing tenant/organization context', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.eval.manage', schema: errorSchema },
        { status: 413, description: 'Request body above twice OM_AGENT_EVAL_SET_MAX_BYTES', schema: errorSchema },
        {
          status: 422,
          description:
            'The eval-set file is invalid: field-level `issues` (schema, unknown scorer, invalid scorer config, judge gate refused, duplicate or unknown keys, size cap)',
          schema: invalidFileSchema,
        },
      ],
    },
  },
}
