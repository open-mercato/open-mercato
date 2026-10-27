import { NextResponse } from 'next/server'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OTEL_EXPORT_CONTENT_MODES, otelExportSettingsSchema } from '../../../data/validators'
import {
  readOtelExportSettings,
  resolveOtelExportDeployment,
} from '../../../lib/trace/otel/exportSettings'
import {
  EMPTY_OTEL_EXPORT_HEALTH,
  readOtelExportHealth,
  type OtelExportHealth,
} from '../../../lib/trace/otel/exportHealth'
import {
  OTEL_EXPORT_CONTENT_WRITE_FEATURES,
  OTEL_EXPORT_WRITE_FEATURES,
  UPDATE_OTEL_EXPORT_SETTINGS_COMMAND_ID,
  hasOtelExportFeatures,
  resolveOtelExportContentError,
  type UpdateOtelExportSettingsCommandInput,
  type UpdateOtelExportSettingsCommandResult,
} from '../../../commands/otelExport'
import { agentOrchestratorTag } from '../../openapi'

/**
 * Read/write the tenant's OTel export settings.
 *
 * Reading uses the trace view gate and returns only a redacted view of the
 * deployment configuration: whether an endpoint and a trace link template are
 * configured, never the endpoint URL, the headers or the template itself.
 * Writing needs `agents.manage` (plus `trace.view_content` to ask for content
 * export) and goes through an undoable command whose `updatedAt` is the
 * optimistic-lock version of the tenant's config row.
 */

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.trace.view'] },
  PUT: { requireAuth: true, requireFeatures: [...OTEL_EXPORT_WRITE_FEATURES] },
}

function deploymentView() {
  const deployment = resolveOtelExportDeployment()
  return {
    enabled: deployment.enabled,
    switchOn: deployment.switchOn,
    endpointConfigured: deployment.endpoint !== null,
    protocol: deployment.protocol,
    protocolSupported: deployment.protocolSupported,
    contentAllowed: deployment.contentAllowed,
    traceLinkConfigured: deployment.traceUrlTemplate !== null,
  }
}

async function readHealth(container: AwilixContainer, tenantId: string | null): Promise<OtelExportHealth> {
  if (!tenantId) return { ...EMPTY_OTEL_EXPORT_HEALTH }
  return readOtelExportHealth(container, tenantId)
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const tenantId = auth.tenantId ?? null
  const { settings, source, updatedAt } = await readOtelExportSettings(container, tenantId)
  const health = await readHealth(container, tenantId)
  return NextResponse.json({ settings, source, updatedAt, deployment: deploymentView(), health })
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId) {
    return NextResponse.json(
      { error: 'A tenant scope is required to save the OTel export settings' },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? null }
  if (!(await hasOtelExportFeatures(container, auth, scope, OTEL_EXPORT_WRITE_FEATURES))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = otelExportSettingsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid OTel export settings', details: parsed.error.issues },
      { status: 400 },
    )
  }

  if (parsed.data.content === 'full') {
    if (!(await hasOtelExportFeatures(container, auth, scope, OTEL_EXPORT_CONTENT_WRITE_FEATURES))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const contentError = resolveOtelExportContentError(parsed.data, resolveOtelExportDeployment())
    if (contentError) return NextResponse.json({ error: contentError }, { status: 422 })
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
      UpdateOtelExportSettingsCommandInput,
      UpdateOtelExportSettingsCommandResult
    >(UPDATE_OTEL_EXPORT_SETTINGS_COMMAND_ID, {
      input: { tenantId: auth.tenantId, settings: parsed.data },
      ctx: commandCtx,
    })
    const health = await readHealth(container, auth.tenantId)
    return NextResponse.json({ ...result, deployment: deploymentView(), health })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    throw err
  }
}

const errorSchema = z.object({ error: z.string() })

const settingsResponseSchema = z.object({
  settings: z.object({
    enabled: z.boolean(),
    content: z.enum(OTEL_EXPORT_CONTENT_MODES),
    exportUserIds: z.boolean(),
    agentAllowlist: z.array(z.string()).optional(),
  }),
  source: z.enum(['tenant', 'default']),
  updatedAt: z.string().nullable(),
  deployment: z.object({
    enabled: z.boolean(),
    switchOn: z.boolean(),
    endpointConfigured: z.boolean(),
    protocol: z.string(),
    protocolSupported: z.boolean(),
    contentAllowed: z.boolean(),
    traceLinkConfigured: z.boolean(),
  }),
  health: z.object({
    lastSuccessAt: z.string().nullable(),
    lastErrorAt: z.string().nullable(),
    lastErrorCode: z.string().nullable(),
  }),
})

const conflictSchema = z.object({
  error: z.string(),
  code: z.string(),
  currentUpdatedAt: z.string(),
  expectedUpdatedAt: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Agent OTel export settings',
  methods: {
    GET: {
      summary: 'Read the tenant OTel export settings',
      description:
        'Returns the tenant’s OTel export settings (or the disabled default), the row version for optimistic locking, a redacted view of the deployment configuration and the last export success/error. The endpoint URL, headers and trace link template are never returned. Gated by agent_orchestrator.trace.view.',
      responses: [{ status: 200, description: 'Resolved settings', schema: settingsResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.trace.view', schema: errorSchema },
      ],
    },
    PUT: {
      summary: 'Save the tenant OTel export settings',
      description:
        'Writes the tenant-scoped settings through the undoable agent_orchestrator.otelExportSettings.update command. Send the x-om-ext-optimistic-lock-expected-updated-at header with the updatedAt from GET to reject a stale save with 409. Requires agent_orchestrator.agents.manage; content "full" also requires agent_orchestrator.trace.view_content and is refused with 422 (content_export_not_allowed while the deployment denies content export, content_export_unavailable otherwise).',
      responses: [{ status: 200, description: 'Saved settings', schema: settingsResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid settings or missing tenant', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        {
          status: 403,
          description: 'Missing agent_orchestrator.agents.manage (or agent_orchestrator.trace.view_content for content export)',
          schema: errorSchema,
        },
        { status: 409, description: 'The settings changed since they were read', schema: conflictSchema },
        { status: 422, description: 'Content export is not allowed or not available', schema: errorSchema },
        { status: 503, description: 'Config store unavailable', schema: errorSchema },
      ],
    },
  },
}
