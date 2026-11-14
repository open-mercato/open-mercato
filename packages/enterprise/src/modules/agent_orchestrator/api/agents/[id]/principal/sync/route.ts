import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { ensureAgentsLoaded, getAgentEntry } from '../../../../../lib/sdk/defineAgent'
import { loadInvokerAcl } from '../../../../../lib/access/agentInvokeAccess'
import { invokerFromAuth } from '../../../../../lib/access/invokeDenial'
import { syncAgentPrincipals } from '../../../../../lib/identity/syncAgentPrincipals'
import { syncSingleAgentPrincipal } from '../../../../../lib/identity/principalSyncCommand'
import {
  agentPrincipalSummarySchema,
  loadAgentPrincipalStates,
  summarizeAgentPrincipal,
} from '../../../../../lib/identity/agentPrincipalSummary'

const IDENTITY_MANAGE_FEATURE = 'agent_orchestrator.identity.manage'
const PRINCIPAL_NOT_DECLARED_CODE = 'agent_principal_not_declared'

const logger = createLogger('agent_orchestrator').child({ component: 'principal-sync-route' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [IDENTITY_MANAGE_FEATURE] },
}

const errorSchema = z.object({ error: z.string() })
const notDeclaredErrorSchema = z.object({ error: z.string(), code: z.literal(PRINCIPAL_NOT_DECLARED_CODE) })

const syncResultSchema = z.object({
  agentId: z.string(),
  outcome: z.enum(['created', 'synced', 'reused']),
  droppedFeatures: z.array(z.string()),
  principal: agentPrincipalSummarySchema,
})

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Reconciles ONE agent's declared principal in the caller's selected
 * organization through the same sync the setup hook and the `principals:sync`
 * CLI use. Other agents' principals are never touched.
 */
export async function POST(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId) return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  const tenantId = auth.tenantId

  const container = await createRequestContainer()
  const orgScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = orgScope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) return NextResponse.json({ error: 'Organization context required' }, { status: 400 })

  const acl = await loadInvokerAcl(container, invokerFromAuth(auth), { tenantId, organizationId })
  if (!authorizeFeatures([IDENTITY_MANAGE_FEATURE], { grantedFeatures: acl.features, unrestricted: acl.isSuperAdmin })) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  await ensureAgentsLoaded()
  const entry = getAgentEntry(id)
  if (!entry) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (!entry.principal) {
    return NextResponse.json(
      { error: 'Agent declares no principal', code: PRINCIPAL_NOT_DECLARED_CODE },
      { status: 422 },
    )
  }

  const scope = { tenantId, organizationId }
  try {
    const synced = await syncSingleAgentPrincipal(
      (syncScope, options) => syncAgentPrincipals(container, syncScope, options),
      scope,
      entry,
    )
    const em = (container.resolve('em') as EntityManager).fork()
    const states = await loadAgentPrincipalStates(em, scope, [entry.id])
    return NextResponse.json({
      agentId: entry.id,
      outcome: synced.outcome,
      droppedFeatures: synced.droppedFeatures,
      principal: summarizeAgentPrincipal(entry, states.get(entry.id)),
    })
  } catch (error) {
    logger.error('agent principal sync failed', {
      agentId: entry.id,
      tenantId,
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    getTelemetryRuntime()?.reportError(error, {
      module: 'agent_orchestrator',
      code: 'agent_orchestrator.principal_sync_failed',
      attributes: { agentId: entry.id },
    })
    return NextResponse.json({ error: 'Principal sync failed' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Sync an agent principal',
  methods: {
    POST: {
      summary: "Sync one agent's declared principal in the selected organization",
      description:
        "Reconciles the agent's declared principal (defineAgent principal) in the caller's selected organization through the same sync as the setup hook and the principals:sync CLI: provisions it on first sync, pins its role ACL to the declared features, re-enables a disabled declared principal, and reuses an externally registered one untouched. Other agents' principals are not touched. Idempotent. Requires agent_orchestrator.identity.manage.",
      responses: [{ status: 200, description: 'Sync outcome and refreshed principal summary', schema: syncResultSchema }],
      errors: [
        { status: 400, description: 'Tenant or organization context missing', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.identity.manage', schema: errorSchema },
        { status: 404, description: 'Unknown agent id', schema: errorSchema },
        { status: 422, description: 'The agent declares no principal', schema: notDeclaredErrorSchema },
        { status: 500, description: 'Principal sync failed', schema: errorSchema },
      ],
    },
  },
}
