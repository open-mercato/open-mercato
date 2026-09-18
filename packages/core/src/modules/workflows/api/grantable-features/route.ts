import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { getModules } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { hasFeature } from '@open-mercato/shared/security/features'
import { WORKFLOW_GRANT_FEATURE } from '../../lib/definition-grant'

/**
 * The vocabulary a workflow author may put into a definition's execution grant.
 *
 * Unlike `auth`'s catalog (gated `auth.acl.manage`) and `agent_orchestrator`'s
 * (which lists every declared feature), this one is INTERSECTED with the
 * caller's own current grants: the save-time rule is that a grant can never
 * exceed the granting user's features, so offering ids that would be refused on
 * save would only produce checkboxes that fail. Ids + titles only — no role or
 * grant data for anyone else leaks through.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: [WORKFLOW_GRANT_FEATURE] },
}

type GrantableFeature = { id: string; title: string; module: string }

const grantableFeatureSchema = z.object({
  id: z.string(),
  title: z.string(),
  module: z.string(),
})

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

export async function GET(request: Request) {
  const auth = await getAuthFromRequest(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  const tenantId = auth.tenantId ?? null

  const rbacService = container.resolve('rbacService') as RbacServiceLike
  const granted = rbacService.getGrantedFeatures
    ? await rbacService.getGrantedFeatures(auth.sub, { tenantId, organizationId })
    : []

  const byId = new Map<string, GrantableFeature>()
  for (const mod of getModules() || []) {
    const features = (mod as { features?: Array<Record<string, unknown>> }).features || []
    for (const feature of features) {
      const id = typeof feature.id === 'string' ? feature.id.trim() : ''
      if (!id || byId.has(id)) continue
      // Wildcard-aware: an author holding `catalog.*` may grant every concrete
      // `catalog.…` id. Never an exact-string check.
      if (!hasFeature(granted, id)) continue
      byId.set(id, {
        id,
        title: typeof feature.title === 'string' && feature.title ? feature.title : id,
        module: typeof feature.module === 'string' && feature.module ? feature.module : String(mod.id ?? ''),
      })
    }
  }

  const items = Array.from(byId.values()).sort(
    (a, b) => a.module.localeCompare(b.module) || a.id.localeCompare(b.id),
  )
  return NextResponse.json({ items })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Workflows',
  summary: 'List the ACL features the caller may grant to a workflow definition',
  methods: {
    GET: {
      summary: 'List grantable execution features',
      description:
        'Declared ACL feature ids/titles intersected with the calling user’s own current grants (wildcard-aware). Drives the definition editor’s execution-permissions picker; gated by workflows.definitions.grant_features.',
      responses: [
        {
          status: 200,
          description: 'Grantable feature catalog',
          schema: z.object({ items: z.array(grantableFeatureSchema) }),
        },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        {
          status: 403,
          description: 'Missing workflows.definitions.grant_features',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
