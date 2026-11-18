import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { TRACE_CAPTURE_LEVELS, traceCapturePolicySchema } from '../../../data/validators'
import {
  readTraceCapturePolicy,
  resolveDeploymentCaptureCeiling,
  resolveDeploymentCaptureDefault,
} from '../../../lib/trace/capturePolicy'
import {
  TRACE_CAPTURE_WRITE_FEATURES,
  UPDATE_TRACE_CAPTURE_POLICY_COMMAND_ID,
  hasTraceCaptureWriteAccess,
  type UpdateTraceCapturePolicyCommandInput,
  type UpdateTraceCapturePolicyCommandResult,
} from '../../../commands/traceCapture'
import { agentOrchestratorTag } from '../../openapi'

/**
 * Read/write the tenant's trace capture policy: how much of each model call
 * (nothing, metadata, or full content) agent runs record.
 *
 * Reading uses the trace view gate. Writing needs `agents.manage` AND
 * `trace.view_content` because it decides whether prompts and responses are
 * retained; the handler re-checks both so the rule holds even if the metadata
 * guard is relaxed. The write goes through an undoable command, and its
 * `updatedAt` is the optimistic-lock version of the tenant's config row.
 */

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.trace.view'] },
  PUT: { requireAuth: true, requireFeatures: [...TRACE_CAPTURE_WRITE_FEATURES] },
}

function deploymentLevels() {
  return {
    deploymentDefault: resolveDeploymentCaptureDefault(),
    deploymentCeiling: resolveDeploymentCaptureCeiling(),
  }
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const { policy, source, updatedAt } = await readTraceCapturePolicy(container, auth.tenantId ?? null)
  return NextResponse.json({ policy, source, ...deploymentLevels(), updatedAt })
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId) {
    return NextResponse.json(
      { error: 'A tenant scope is required to save the trace capture policy' },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const allowed = await hasTraceCaptureWriteAccess(container, auth, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
  })
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = traceCapturePolicySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid trace capture policy', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const commandBus = container.resolve('commandBus') as CommandBus
  const commandCtx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: null,
    selectedOrganizationId: auth.orgId ?? null,
    organizationIds: auth.orgId ? [auth.orgId] : null,
    request: req,
  }

  try {
    const { result } = await commandBus.execute<
      UpdateTraceCapturePolicyCommandInput,
      UpdateTraceCapturePolicyCommandResult
    >(UPDATE_TRACE_CAPTURE_POLICY_COMMAND_ID, {
      input: { tenantId: auth.tenantId, policy: parsed.data },
      ctx: commandCtx,
    })
    return NextResponse.json({ ...result, ...deploymentLevels() })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    throw err
  }
}

const errorSchema = z.object({ error: z.string() })
const captureLevelSchema = z.enum(TRACE_CAPTURE_LEVELS)

const settingsResponseSchema = z.object({
  policy: z.object({
    level: captureLevelSchema,
    evalLevel: captureLevelSchema.optional(),
    perAgent: z.record(
      z.string(),
      z.object({ level: captureLevelSchema, until: z.string().optional() }),
    ),
    retentionDays: z.number().int(),
    redactPii: z.boolean(),
    includeProviderBody: z.boolean(),
  }),
  source: z.enum(['tenant', 'default']),
  deploymentDefault: captureLevelSchema,
  deploymentCeiling: captureLevelSchema,
  updatedAt: z.string().nullable(),
})

const conflictSchema = z.object({
  error: z.string(),
  code: z.string(),
  currentUpdatedAt: z.string(),
  expectedUpdatedAt: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Agent trace capture policy',
  methods: {
    GET: {
      summary: 'Read the tenant trace capture policy',
      description:
        'Returns the policy agent runs apply to model-call capture, whether it is the tenant’s own row or the inherited default, the deployment default and ceiling levels, and the row version for optimistic locking. Gated by agent_orchestrator.trace.view.',
      responses: [{ status: 200, description: 'Resolved policy', schema: settingsResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.trace.view', schema: errorSchema },
      ],
    },
    PUT: {
      summary: 'Save the tenant trace capture policy',
      description:
        'Writes the tenant-scoped policy through the undoable agent_orchestrator.traceCapturePolicy.update command. The complete object is required. Send the x-om-ext-optimistic-lock-expected-updated-at header with the updatedAt from GET to reject a stale save with 409. Requires agent_orchestrator.agents.manage and agent_orchestrator.trace.view_content.',
      responses: [{ status: 200, description: 'Saved policy', schema: settingsResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid policy or missing tenant', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        {
          status: 403,
          description: 'Missing agent_orchestrator.agents.manage or agent_orchestrator.trace.view_content',
          schema: errorSchema,
        },
        { status: 409, description: 'The policy changed since it was read', schema: conflictSchema },
        { status: 503, description: 'Config store unavailable', schema: errorSchema },
      ],
    },
  },
}
