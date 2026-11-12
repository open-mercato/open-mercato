import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { ACTION_RISK_TIERS } from '../../../lib/disposition/autoApprovalPolicy'
import {
  AUTO_APPROVAL_CONFIG_MODULE,
  AUTO_APPROVAL_CONFIG_NAME,
  readTenantAutoApprovalPolicy,
  tenantAutoApprovalPolicySchema,
} from '../../../lib/disposition/tenantAutoApprovalPolicy'
import { agentOrchestratorTag } from '../../openapi'

/**
 * Read/write the tenant's standing decision about unattended action.
 *
 * `resolveTenantAutoApprovalPolicy` has always READ this record; nothing wrote
 * it, so every tenant silently ran the conservative default and an operator
 * whose proposal was held by the risk ceiling had no way to raise it and no
 * screen saying it existed. This is that screen's endpoint.
 *
 * Reading uses the module's view gate so the page is reachable wherever the
 * other agent pages are. Writing stays on `agents.manage`: it decides what may
 * happen to this tenant's data without a person in the loop.
 */

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.view'] },
  PUT: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.manage'] },
}

type ModuleConfigServiceLike = {
  setValue(
    moduleId: string,
    name: string,
    value: unknown,
    scope?: { tenantId?: string | null },
  ): Promise<unknown>
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const { policy, source } = await readTenantAutoApprovalPolicy(container, auth.tenantId ?? null)
  return NextResponse.json({ policy, source, riskTiers: ACTION_RISK_TIERS })
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId) {
    return NextResponse.json(
      { error: 'A tenant scope is required to save the auto-approval policy' },
      { status: 400 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // The whole object or nothing: the schema this writes is the same one the
  // reader parses, and it accepts no partial. A body that could omit
  // `maxAutoApproveRisk` would raise the ceiling by silence, which is exactly the
  // reading `resolveTenantAutoApprovalPolicy` refuses to make.
  const parsed = tenantAutoApprovalPolicySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid auto-approval policy', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  let service: ModuleConfigServiceLike
  try {
    service = container.resolve('moduleConfigService') as ModuleConfigServiceLike
  } catch {
    return NextResponse.json({ error: 'Module configuration store is unavailable' }, { status: 503 })
  }

  await service.setValue(AUTO_APPROVAL_CONFIG_MODULE, AUTO_APPROVAL_CONFIG_NAME, parsed.data, {
    tenantId: auth.tenantId,
  })

  return NextResponse.json({ policy: parsed.data, source: 'tenant', riskTiers: ACTION_RISK_TIERS })
}

const policyResponseSchema = z.object({
  policy: z.object({
    enabled: z.boolean(),
    maxAutoApproveRisk: z.enum(ACTION_RISK_TIERS),
  }),
  source: z.enum(['tenant', 'default']),
  riskTiers: z.array(z.enum(ACTION_RISK_TIERS)),
})

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Agent auto-approval policy',
  methods: {
    GET: {
      summary: 'Read the tenant auto-approval policy',
      description:
        'Returns the policy the disposition service applies, and whether it is the tenant’s own row or the inherited conservative default. Gated by agent_orchestrator.agents.view.',
      responses: [{ status: 200, description: 'Resolved policy', schema: policyResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        {
          status: 403,
          description: 'Missing agent_orchestrator.agents.view',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
    PUT: {
      summary: 'Save the tenant auto-approval policy',
      description:
        'Writes the tenant-scoped policy row: the master switch and the highest action risk that may run unattended. The complete object is required.',
      responses: [{ status: 200, description: 'Saved policy', schema: policyResponseSchema }],
      errors: [
        {
          status: 400,
          description: 'Invalid policy or missing tenant',
          schema: z.object({ error: z.string() }),
        },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        {
          status: 403,
          description: 'Missing agent_orchestrator.agents.manage',
          schema: z.object({ error: z.string() }),
        },
        { status: 503, description: 'Config store unavailable', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
