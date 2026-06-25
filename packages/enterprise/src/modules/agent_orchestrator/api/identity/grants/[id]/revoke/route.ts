import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { revokeAgentDelegationGrantSchema } from '../../../../../data/validators'
import type {
  RevokeGrantCommandInput,
  RevokeGrantCommandResult,
} from '../../../../../commands/grants'

/**
 * Revoke an external agent's delegation grant (Wave 4 Phase 3). Routes through the
 * audited revoke Command (mutation guard + optimistic lock). After revoke the
 * grant is inactive, so the `/token` server refuses to mint and every minted token
 * is denied on its NEXT request — revocation stops further action immediately.
 * Optimistic-locked: a stale `updated_at` returns the structured 409 the unified
 * conflict bar reads (surfaceRecordConflict). Org-scoped: a grant in another tenant
 * surfaces as 404 (or 409 when the client sent the expected-version header).
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.identity.tokens'] },
}

const errorSchema = z.object({ error: z.string() })

const revokeResultSchema = z.object({
  grantId: z.string().uuid(),
  revokedAt: z.string(),
  updatedAt: z.string(),
})

const optimisticLockConflictSchema = z.object({
  error: z.string(),
  code: z.string(),
  currentUpdatedAt: z.string(),
  expectedUpdatedAt: z.string(),
})

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId || !auth.sub) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  }

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid grant id' }, { status: 400 })
  }

  const body = await readJsonSafe(req, {})
  const parsed = revokeAgentDelegationGrantSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const commandBus = container.resolve('commandBus') as CommandBus

  const commandCtx: CommandRuntimeContext = {
    container,
    auth: {
      sub: auth.sub,
      tenantId: auth.tenantId,
      orgId: auth.orgId,
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: auth.orgId,
    organizationIds: [auth.orgId],
    request: req,
  }

  const input: RevokeGrantCommandInput = {
    grantId: id,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    userId: auth.sub,
    expectedUpdatedAt: parsed.data.expectedUpdatedAt,
  }

  try {
    const { result } = await commandBus.execute<RevokeGrantCommandInput, RevokeGrantCommandResult>(
      'agent_orchestrator.grants.revoke',
      { input, ctx: commandCtx },
    )
    return NextResponse.json(result)
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    throw err
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Revoke an agent delegation grant',
  methods: {
    POST: {
      summary: 'Revoke a delegation grant',
      description:
        'Sets revokedAt on an AgentDelegationGrant through the audited revoke Command (mutation guard + optimistic lock). After revoke, the /token server refuses to mint and every minted token is denied on its next request — revocation stops further agent action immediately. A stale updatedAt returns a structured 409.',
      requestBody: {
        contentType: 'application/json',
        schema: revokeAgentDelegationGrantSchema,
        description: 'Optional expected updated_at for optimistic locking (also accepted via the standard header).',
      },
      responses: [
        { status: 200, description: 'The revoked grant', schema: revokeResultSchema },
      ],
      errors: [
        { status: 400, description: 'Tenant context missing or invalid input', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.identity.tokens', schema: errorSchema },
        { status: 404, description: 'Grant not found (or cross-tenant)', schema: errorSchema },
        {
          status: 409,
          description: 'Optimistic-lock conflict (stale updatedAt)',
          schema: optimisticLockConflictSchema,
        },
      ],
    },
  },
}
