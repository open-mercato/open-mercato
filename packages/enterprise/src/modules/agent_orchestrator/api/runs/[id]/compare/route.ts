import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentRun, AgentSpan } from '../../../../data/entities'
import { ARTIFACT_REFS } from '../../../../lib/trace/artifactStore'
import { readTraceCapturePolicy } from '../../../../lib/trace/capturePolicy'
import {
  hasTraceViewContentAccess,
  readTraceContentArtifact,
  traceContentActorFromAuth,
} from '../../../../lib/trace/contentArtifactAccess'
import { readLlmSpanMetadata, type LlmSpanMetadata } from '../../../../lib/trace/genAiAttributes'
import { findRunManifestView, type RunManifestView } from '../../../../lib/trace/runManifestView'
import {
  diffManifests,
  diffRequestContent,
  diffRequestParams,
  type JsonDiff,
  type TextDiff,
} from '../../../../lib/trace/runCompare'

/**
 * Side-by-side diff of one model call (`step`, the n-th `llm` span by sequence)
 * of two runs: run-manifest and request-parameter diffs on `trace.view`, plus
 * system-prompt / messages / tool-definition diffs of the captured request
 * content when the caller also holds `trace.view_content`. Both runs must be in
 * the caller's tenant and organization (404 otherwise); each run's spans and
 * content are read in that run's own scope, and every content read is
 * access-logged. A side whose content is expired, unavailable or never captured
 * reports that status instead of failing the request.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.trace.view'] },
}

const idSchema = z.string().uuid()

export const querySchema = z.object({
  with: z.string().uuid(),
  step: z.coerce.number().int().min(0).max(10_000).default(0),
})

const errorSchema = z.object({ error: z.string() })

const contentSideStatusSchema = z.enum(['ok', 'expired', 'unavailable', 'not_captured', 'forbidden'])
type ContentSideStatus = z.infer<typeof contentSideStatusSchema>

const fieldDiffSchema = z.object({ key: z.string(), left: z.unknown(), right: z.unknown() })
const textDiffSchema = z.object({
  changed: z.boolean(),
  truncated: z.boolean(),
  lines: z.array(z.object({ op: z.enum(['equal', 'added', 'removed']), text: z.string() })),
})
const jsonDiffSchema = z.object({
  changed: z.boolean(),
  truncated: z.boolean(),
  entries: z.array(
    z.object({
      path: z.string(),
      op: z.enum(['added', 'removed', 'changed']),
      left: z.unknown().optional(),
      right: z.unknown().optional(),
    }),
  ),
})

const stepSummarySchema = z.object({
  runId: z.string(),
  agentId: z.string(),
  status: z.string(),
  model: z.string().nullable(),
  runtime: z.string().nullable(),
  step: z.number(),
  llmStepCount: z.number(),
  spanId: z.string().nullable(),
  spanName: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  contentStatus: contentSideStatusSchema,
})

export const responseSchema = z.object({
  step: z.number(),
  content: z.enum(['included', 'forbidden']),
  left: stepSummarySchema,
  right: stepSummarySchema,
  diff: z.object({
    manifest: z.array(fieldDiffSchema),
    params: z.array(fieldDiffSchema),
    systemPrompt: textDiffSchema.optional(),
    messages: jsonDiffSchema.optional(),
    tools: jsonDiffSchema.optional(),
  }),
})

type RouteContext = { params: Promise<{ id: string }> }

type LoadedSide = {
  run: AgentRun
  manifest: RunManifestView | null
  llmSpans: AgentSpan[]
  stepSpan: AgentSpan | null
  stepMetadata: LlmSpanMetadata | null
}

type ContentSide = { status: ContentSideStatus; payload: unknown }

async function loadRun(
  em: EntityManager,
  auth: Exclude<AuthContext, null> & { tenantId: string },
  runId: string,
): Promise<AgentRun | null> {
  return findOneWithDecryption(
    em,
    AgentRun,
    { id: runId, tenantId: auth.tenantId, organizationId: auth.orgId ?? undefined, deletedAt: null },
    undefined,
    { tenantId: auth.tenantId, organizationId: auth.orgId ?? null },
  )
}

async function loadSide(em: EntityManager, run: AgentRun, step: number): Promise<LoadedSide> {
  const runScope = { tenantId: run.tenantId, organizationId: run.organizationId }
  const spans = await findWithDecryption(
    em,
    AgentSpan,
    { agentRunId: run.id, ...runScope },
    { orderBy: { sequence: 'asc' } },
    runScope,
  )
  const llmSpans = spans.filter((span) => span.kind === 'llm')
  const stepSpan = llmSpans[step] ?? null
  return {
    run,
    manifest: findRunManifestView(spans),
    llmSpans,
    stepSpan,
    stepMetadata: stepSpan ? readLlmSpanMetadata(stepSpan.attributes) : null,
  }
}

async function readSideContent(
  container: AwilixContainer,
  auth: Exclude<AuthContext, null>,
  side: LoadedSide,
  retentionDays: number,
): Promise<ContentSide> {
  const key = side.stepMetadata?.contentRequestKey
  if (!key) return { status: 'not_captured', payload: null }
  const result = await readTraceContentArtifact(container, {
    scope: { tenantId: side.run.tenantId, organizationId: side.run.organizationId },
    runId: side.run.id,
    kind: 'llm_request',
    ref: ARTIFACT_REFS.llmRequest,
    key,
    retentionDays,
    actor: traceContentActorFromAuth(auth),
  })
  if (result.status === 'ok') return { status: 'ok', payload: result.value }
  return { status: result.status, payload: null }
}

function toStepSummary(side: LoadedSide, step: number, contentStatus: ContentSideStatus) {
  return {
    runId: side.run.id,
    agentId: side.run.agentId,
    status: side.run.status,
    model: side.run.model ?? null,
    runtime: side.run.runtime ?? null,
    step,
    llmStepCount: side.llmSpans.length,
    spanId: side.stepSpan?.id ?? null,
    spanName: side.stepSpan?.name ?? null,
    metadata: side.stepMetadata,
    contentStatus,
  }
}

async function readBothSides(
  container: AwilixContainer,
  auth: Exclude<AuthContext, null> & { tenantId: string },
  left: LoadedSide,
  right: LoadedSide,
): Promise<[ContentSide, ContentSide]> {
  const { policy } = await readTraceCapturePolicy(container, auth.tenantId)
  return Promise.all([
    readSideContent(container, auth, left, policy.retentionDays),
    readSideContent(container, auth, right, policy.retentionDays),
  ])
}

type ContentDiffPart = { systemPrompt?: TextDiff; messages?: JsonDiff; tools?: JsonDiff }

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const scopedAuth = { ...auth, tenantId: auth.tenantId }

  const { id } = await ctx.params
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const url = new URL(req.url)
  const parsedQuery = querySchema.safeParse({
    with: url.searchParams.get('with') ?? undefined,
    step: url.searchParams.get('step') ?? undefined,
  })
  if (!parsedQuery.success) return NextResponse.json({ error: 'Invalid compare request' }, { status: 422 })
  const { with: otherRunId, step } = parsedQuery.data

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const [leftRun, rightRun] = await Promise.all([
    loadRun(em, scopedAuth, parsedId.data),
    loadRun(em, scopedAuth, otherRunId),
  ])
  if (!leftRun || !rightRun) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const [left, right] = await Promise.all([loadSide(em, leftRun, step), loadSide(em, rightRun, step)])

  const canViewContent = await hasTraceViewContentAccess(container, auth, auth.tenantId)
  const forbidden: ContentSide = { status: 'forbidden', payload: null }
  const [leftContent, rightContent] = canViewContent
    ? await readBothSides(container, scopedAuth, left, right)
    : [forbidden, forbidden]
  const contentDiff: ContentDiffPart =
    leftContent.status === 'ok' && rightContent.status === 'ok'
      ? diffRequestContent(leftContent.payload, rightContent.payload)
      : {}

  return NextResponse.json({
    step,
    content: canViewContent ? 'included' : 'forbidden',
    left: toStepSummary(left, step, leftContent.status),
    right: toStepSummary(right, step, rightContent.status),
    diff: {
      manifest: diffManifests(left.manifest, right.manifest),
      params: diffRequestParams(left.stepMetadata, right.stepMetadata),
      ...contentDiff,
    },
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Compare one model call of two agent runs',
  methods: {
    GET: {
      summary: 'Diff the run manifest, request parameters and captured request content of two runs at one step',
      description:
        '`step` selects the n-th `llm` span (0-based, by sequence) of each run. `diff.manifest` and `diff.params` (`gen_ai.request.*`) list only changed fields and need agent_orchestrator.trace.view. With agent_orchestrator.trace.view_content the captured request content of each side is read (and access-logged) and, when both sides are available, `diff.systemPrompt` (line diff), `diff.messages` and `diff.tools` (JSON-path diffs) are added; diffs are bounded and flag `truncated`. Without it `content` is `forbidden` and only metadata is diffed. Per-side `contentStatus` is `ok`, `expired`, `unavailable`, `not_captured` or `forbidden`. Both runs must belong to the caller organization (404 otherwise).',
      query: querySchema,
      responses: [{ status: 200, description: 'Run comparison', schema: responseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.trace.view', schema: errorSchema },
        { status: 404, description: 'Either run is not found in the caller scope', schema: errorSchema },
        { status: 422, description: 'Invalid compare request', schema: errorSchema },
      ],
    },
  },
}
