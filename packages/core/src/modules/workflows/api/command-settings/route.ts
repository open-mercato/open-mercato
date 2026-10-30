/**
 * Tenant enablement for UPDATE_ENTITY commands (tier 2 of the model described
 * in `lib/workflow-command-enablement.ts`).
 *
 * - GET  /api/workflows/command-settings — the catalogue with this tenant's answer
 * - PUT  /api/workflows/command-settings — tick / untick candidates
 *
 * A new route, which BACKWARD_COMPATIBILITY.md §7 allows freely. Shape follows
 * `api/task-settings/route.ts`.
 *
 * The PUT body carries command IDS, never a free-form command name: every id is
 * checked against the code-declared catalogue and an unknown one is a 400. That
 * refusal IS the safety model — an administrator who could type an arbitrary id
 * would reach commands nobody designed for unattended execution, and a command
 * with no declared `requiredFeatures` would have no gate left at all.
 *
 * `tenantId` always comes from the authenticated context and never from the
 * request body — a settings write that accepted a tenant id would be a
 * cross-tenant write primitive.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { listWorkflowSafeCommands } from '../../lib/workflow-safe-commands'
import {
  findUncataloguedCommandIds,
  mergeEnabledCommandIds,
  resolveWorkflowCommandCatalogue,
  UNSET_WORKFLOW_COMMAND_POLICY,
} from '../../lib/workflow-command-enablement'
import {
  readEnabledWorkflowCommandIds,
  resolveWorkflowCommandConfigService,
  writeEnabledWorkflowCommandIds,
  type WorkflowCommandConfigService,
} from '../../lib/workflow-command-settings'
import {
  workflowsTag,
  workflowErrorSchema,
  workflowCommandSettingsResponseSchema,
  workflowCommandSettingsPutBodySchema,
  workflowCommandSettingsPutResponseSchema,
} from '../openapi'

export const metadata = {
  // Reading which commands a workflow may execute is what a definition author
  // needs in order to author one, so it rides on the definition-view feature
  // rather than on task administration.
  GET: { requireAuth: true, requireFeatures: ['workflows.definitions.view'] },
  // Ticking a candidate widens what EVERY workflow in the tenant may mutate.
  PUT: { requireAuth: true, requireFeatures: ['workflows.manage'] },
}

const putBodySchema = z.object({
  enabledCommandIds: z.array(z.string().min(1)).max(500),
})

async function resolveModuleConfigService(): Promise<WorkflowCommandConfigService | null> {
  try {
    const container = await createRequestContainer()
    return resolveWorkflowCommandConfigService(container)
  } catch {
    // Fails to the UNSET policy, i.e. the grandfathered set — never to
    // "everything enabled".
    return null
  }
}

export async function GET(request: Request) {
  const auth = await getAuthFromRequest(request)
  if (!auth || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const moduleConfigService = await resolveModuleConfigService()
  const stored = await readEnabledWorkflowCommandIds(moduleConfigService, auth.tenantId)
  const catalogue = listWorkflowSafeCommands()

  return NextResponse.json({
    configured: stored !== null,
    items: resolveWorkflowCommandCatalogue(
      catalogue,
      stored === null ? UNSET_WORKFLOW_COMMAND_POLICY : { enabledCommandIds: stored },
    ),
  })
}

export async function PUT(request: Request) {
  const auth = await getAuthFromRequest(request)
  if (!auth || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = putBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const catalogue = listWorkflowSafeCommands()
  const unknownCommandIds = findUncataloguedCommandIds(parsed.data.enabledCommandIds, catalogue)
  if (unknownCommandIds.length > 0) {
    return NextResponse.json(
      {
        error: 'Unknown workflow-safe command',
        code: 'WORKFLOW_COMMAND_NOT_IN_CATALOGUE',
        commandIds: unknownCommandIds,
      },
      { status: 400 },
    )
  }

  const moduleConfigService = await resolveModuleConfigService()
  if (!moduleConfigService) {
    return NextResponse.json({ error: 'Settings storage unavailable' }, { status: 503 })
  }

  const stored = await readEnabledWorkflowCommandIds(moduleConfigService, auth.tenantId)
  const enabledCommandIds = mergeEnabledCommandIds(
    parsed.data.enabledCommandIds,
    stored,
    catalogue,
  )
  await writeEnabledWorkflowCommandIds(moduleConfigService, auth.tenantId, enabledCommandIds)

  return NextResponse.json({
    ok: true,
    configured: true,
    items: resolveWorkflowCommandCatalogue(catalogue, { enabledCommandIds }),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Tenant UPDATE_ENTITY command enablement',
  methods: {
    GET: {
      summary: 'List workflow-safe command candidates with tenant enablement',
      description:
        'Returns every command declared through registerWorkflowSafeCommands together with whether this tenant has switched it on. `configured: false` means the tenant has never saved the setting and the answers come from the grandfathered defaults.',
      responses: [
        { status: 200, description: 'Catalogue with tenant enablement', schema: workflowCommandSettingsResponseSchema },
        { status: 401, description: 'Missing authentication', schema: workflowErrorSchema },
      ],
    },
    PUT: {
      summary: 'Set which workflow-safe commands are enabled for the tenant',
      description:
        'Replaces the tenant\'s enabled set. Every submitted id must be present in the code-declared catalogue; an unknown id is rejected with 400 rather than stored. Stored ids whose declaring module is not loaded in this process are retained so a save can never silently untick them.',
      requestBody: { schema: workflowCommandSettingsPutBodySchema },
      responses: [
        { status: 200, description: 'Updated enablement', schema: workflowCommandSettingsPutResponseSchema },
        { status: 400, description: 'Invalid payload or unknown command id', schema: workflowErrorSchema },
        { status: 401, description: 'Missing authentication', schema: workflowErrorSchema },
        { status: 503, description: 'Settings storage unavailable', schema: workflowErrorSchema },
      ],
    },
  },
}
