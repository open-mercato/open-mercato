import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { AwilixContainer } from 'awilix'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { AgentContextBundle, AgentGuardrailCheck, AgentRun, AgentSpan, AgentToolCall } from '../../../../data/entities'
import {
  ARTIFACT_REFS,
  getArtifact,
  readArtifact,
  type ArtifactEncryptionRef,
  type ArtifactScope,
} from '../../../../lib/trace/artifactStore'
import { readRawOutputKey } from '../../../../lib/guardrails/integrity/summary'
import { OM_LLM_ATTRIBUTES } from '../../../../lib/trace/genAiAttributes'
import { readTraceCapturePolicy } from '../../../../lib/trace/capturePolicy'
import { isTraceContentKeyExpired, recordTraceContentAccess } from '../../../../lib/trace/contentArtifactAccess'
import { loadInvokerAcl } from '../../../../lib/access/agentInvokeAccess'
import { invokerFromAuth } from '../../../../lib/access/invokeDenial'
import { agentOrchestratorTag } from '../../../openapi'

/**
 * On-demand fetch of a full offloaded trace artifact (F1). Large run outputs and
 * tool request/response payloads are stored encrypted in `storage-s3` with only
 * a redacted summary + key on the row; the inspector calls this to retrieve the
 * full value. The requested key MUST belong to the addressed run (validated
 * against the run's own artifact-key columns, or — for `raw_output`, the
 * pre-repair model output — against `evidence.rawOutput.key` on the run's
 * guardrail check rows) so no arbitrary key can be read,
 * and the storage scope is the run's own tenant/org — matching the upload scope.
 *
 * The content kinds (`llm_request`, `llm_response`, `context_payload`) carry
 * full prompts and additionally require `agent_orchestrator.trace.view_content`
 * (checked in-handler, 403). Their key must be referenced by an `llm` span of
 * this run (`om.content.request.key` / `.response.key`) or by the run's context
 * bundle `payloadRef`. Expired (older than the tenant's `retentionDays`) or
 * missing objects return 410, and every successful read is access-logged.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.trace.view'] },
}

const idSchema = z.string().uuid()
const querySchema = z.object({
  key: z.string().min(1).max(500),
  kind: z.enum(['output', 'tool_request', 'tool_response', 'raw_output', 'llm_request', 'llm_response', 'context_payload']),
})

type ArtifactKind = z.infer<typeof querySchema>['kind']
type ContentKind = Extract<ArtifactKind, 'llm_request' | 'llm_response' | 'context_payload'>

const VIEW_CONTENT_FEATURE = 'agent_orchestrator.trace.view_content'
const CONTENT_KINDS: ReadonlySet<ArtifactKind> = new Set<ArtifactKind>(['llm_request', 'llm_response', 'context_payload'])

function isContentKind(kind: ArtifactKind): kind is ContentKind {
  return CONTENT_KINDS.has(kind)
}

const CONTENT_REFS: Record<ContentKind, ArtifactEncryptionRef> = {
  llm_request: ARTIFACT_REFS.llmRequest,
  llm_response: ARTIFACT_REFS.llmResponse,
  context_payload: ARTIFACT_REFS.contextPayload,
}

async function hasViewContentAccess(
  container: AwilixContainer,
  auth: Exclude<AuthContext, null>,
  tenantId: string,
): Promise<boolean> {
  const acl = await loadInvokerAcl(container, invokerFromAuth(auth), {
    tenantId,
    organizationId: auth.orgId ?? null,
  })
  return authorizeFeatures([VIEW_CONTENT_FEATURE], { grantedFeatures: acl.features, unrestricted: acl.isSuperAdmin })
}

function readAttribute(attributes: unknown, name: string): string | null {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return null
  const value = (attributes as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : null
}

async function isContentKeyOwnedByRun(
  em: EntityManager,
  scope: ArtifactScope,
  runId: string,
  kind: ContentKind,
  key: string,
): Promise<boolean> {
  if (kind === 'context_payload') {
    const bundles = await findWithDecryption(
      em,
      AgentContextBundle,
      { agentRunId: runId, ...scope, payloadRef: key },
      undefined,
      scope,
    )
    return bundles.length > 0
  }
  const attribute = kind === 'llm_request' ? OM_LLM_ATTRIBUTES.contentRequestKey : OM_LLM_ATTRIBUTES.contentResponseKey
  const spans = await findWithDecryption(em, AgentSpan, { agentRunId: runId, ...scope, kind: 'llm' }, undefined, scope)
  return spans.some((span) => readAttribute(span.attributes, attribute) === key)
}

async function serveContentArtifact(input: {
  container: AwilixContainer
  em: EntityManager
  auth: Exclude<AuthContext, null>
  run: AgentRun
  kind: ContentKind
  key: string
}): Promise<NextResponse> {
  const { container, em, auth, run, kind, key } = input
  const storageScope = { tenantId: run.tenantId, organizationId: run.organizationId }
  if (!(await isContentKeyOwnedByRun(em, storageScope, run.id, kind, key))) {
    return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
  }
  const { policy } = await readTraceCapturePolicy(container, run.tenantId)
  if (isTraceContentKeyExpired(key, policy.retentionDays)) {
    return NextResponse.json({ error: 'Artifact expired under the retention policy' }, { status: 410 })
  }
  const result = await readArtifact(container, storageScope, CONTENT_REFS[kind], key)
  if (result.status === 'missing') {
    return NextResponse.json({ error: 'Artifact expired under the retention policy' }, { status: 410 })
  }
  if (result.status === 'unavailable') {
    return NextResponse.json({ error: 'Artifact is currently unavailable' }, { status: 502 })
  }
  const isApiKey = auth.isApiKey === true
  await recordTraceContentAccess(container, {
    ...storageScope,
    actorUserId: isApiKey ? auth.userId || null : auth.sub,
    apiKeyId: isApiKey ? auth.keyId || null : null,
    runId: run.id,
    kind,
    key,
  })
  return NextResponse.json({ key, kind, payload: result.value })
}

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const url = new URL(req.url)
  const parsedQuery = querySchema.safeParse({ key: url.searchParams.get('key'), kind: url.searchParams.get('kind') })
  if (!parsedQuery.success) {
    return NextResponse.json({ error: 'Invalid artifact request' }, { status: 422 })
  }
  const { key, kind } = parsedQuery.data

  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? undefined }
  const container = await createRequestContainer()

  if (isContentKind(kind) && !(await hasViewContentAccess(container, auth, auth.tenantId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const em = (container.resolve('em') as EntityManager).fork()

  const run = await em.findOne(AgentRun, { id: parsedId.data, ...scope, deletedAt: null })
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  if (isContentKind(kind)) {
    return serveContentArtifact({ container, em, auth, run, kind, key })
  }

  // The key must belong to this run's own artifact columns — otherwise a caller
  // could read any tenant key by guessing. `ref` also selects the decryption map.
  let ref: ArtifactEncryptionRef
  if (kind === 'output') {
    if (run.outputArtifactKey !== key) return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
    ref = ARTIFACT_REFS.runOutput
  } else if (kind === 'raw_output') {
    const checkScope = { tenantId: run.tenantId, organizationId: run.organizationId }
    const checks = await findWithDecryption(
      em,
      AgentGuardrailCheck,
      { agentRunId: run.id, ...checkScope },
      undefined,
      checkScope,
    )
    if (!checks.some((check) => readRawOutputKey(check.evidence) === key)) {
      return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
    }
    ref = ARTIFACT_REFS.runRawOutput
  } else {
    const where =
      kind === 'tool_request'
        ? { agentRunId: run.id, tenantId: auth.tenantId, requestArtifactKey: key }
        : { agentRunId: run.id, tenantId: auth.tenantId, responseArtifactKey: key }
    const toolCall = await em.findOne(AgentToolCall, where)
    if (!toolCall) return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
    ref = kind === 'tool_request' ? ARTIFACT_REFS.toolRequest : ARTIFACT_REFS.toolResponse
  }

  // Storage scope is the run's own tenant/org (symmetric with the upload scope).
  const storageScope = { tenantId: run.tenantId, organizationId: run.organizationId }
  const payload = await getArtifact(container, storageScope, ref, key)
  if (payload === null) {
    return NextResponse.json({ error: 'Artifact is currently unavailable' }, { status: 502 })
  }

  return NextResponse.json({ key, kind, payload })
}

export const openApi = {
  tags: [agentOrchestratorTag],
  summary: 'Fetch a full offloaded trace artifact',
  methods: {
    GET: {
      summary:
        'Retrieve the full (decrypted) offloaded output, pre-repair raw model output, tool payload or captured LLM/context content for a run by storage key',
      description:
        '`kind=raw_output` returns the model output before integrity repair; its key must be referenced by `evidence.rawOutput.key` on one of this run\'s guardrail check rows. `kind=llm_request|llm_response|context_payload` return full-fidelity captured content: they additionally require `agent_orchestrator.trace.view_content`, the key must be referenced by `om.content.request.key` / `om.content.response.key` on an `llm` span of this run or by its context bundle `payloadRef`, content older than the tenant retention window returns 410, and every successful read is recorded in the access log.',
      query: querySchema,
      tags: [agentOrchestratorTag],
      responses: [
        { status: 200, description: 'Decrypted artifact payload' },
        { status: 403, description: 'Content kind requested without agent_orchestrator.trace.view_content' },
        { status: 404, description: 'Run or artifact key not found for this scope' },
        { status: 410, description: 'Content expired under the retention policy or no longer stored' },
        { status: 422, description: 'Invalid artifact request' },
        { status: 502, description: 'Artifact storage unavailable' },
      ],
    },
  },
}
