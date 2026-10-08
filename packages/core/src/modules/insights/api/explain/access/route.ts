import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { readQueryParamList } from '@open-mercato/shared/lib/crud/query-params'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import {
  accessExplainQuerySchema,
  accessExplainResponseSchema,
  explainErrorSchema,
} from '../../../data/validators'
import { explainInternalError, explainJson } from '../../../lib/routeHelpers'
import type { AccessExplainService } from '../../../services/accessExplainService'

export const metadata = {
  GET: { requireAuth: true },
}

function normalizeId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readOptionalParam(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key)
  return value === null ? undefined : value
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const parsed = accessExplainQuerySchema.safeParse({
      features: readQueryParamList(url.searchParams, 'features'),
      path: readOptionalParam(url.searchParams, 'path'),
      userId: readOptionalParam(url.searchParams, 'userId'),
    })
    if (!parsed.success) return explainJson({ error: 'invalid_query', details: parsed.error.issues }, 400)
    const auth = await getAuthFromRequest(req)
    if (!auth) return explainJson({ error: 'unauthorized' }, 401)
    const container = await createRequestContainer()
    const { organizationId, scope } = await resolveFeatureCheckContext({ container, auth, request: req })
    const tenantId = normalizeId(scope.tenantId) ?? normalizeId(auth.tenantId)
    if (!tenantId) return explainJson({ error: 'tenant_required' }, 403)
    const filter = resolveOrganizationScopeFilter(scope, auth)
    const service = container.resolve('accessExplainService') as AccessExplainService
    const outcome = await service.explain(
      {
        auth,
        tenantId,
        organizationId: normalizeId(organizationId),
        selectedOrganizationId: normalizeId(scope.selectedId),
        organizationIds: filter.organizationIds === undefined ? null : Array.from(new Set(filter.organizationIds)),
      },
      parsed.data,
    )
    if (!outcome.ok) return explainJson(outcome.body, outcome.status)
    return explainJson(outcome.body)
  } catch (error) {
    return explainInternalError(error, 'access')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Explain an access decision',
  description: 'Explains whether a user holds a set of features and, when not, why (RBAC and feature policy).',
  methods: {
    GET: {
      summary: 'Explain access to features',
      description:
        'Evaluates the requested features exactly like the route and page guards (`userHasAllFeatures`, wildcard-aware, organization-scoped) and returns the decision, per-feature grants and the reasons for a denial. Without `userId` the caller is explained at the organization the guards use for them. `detail` (grant source, roles, per-user ACL, roles that would grant, organizations where the features are granted, recent ACL changes) is returned only with `insights.explain.access_detail`. Explaining another user requires `insights.explain.access_detail` and `auth.users.list`; a user outside the caller\'s tenant or organization scope returns 404. When every feature is granted to the caller and `path` is given, the denial came from a rule outside RBAC and is reported as `not_determinable` (`path` is ignored when explaining another user). Per-entity record features of restricted custom entities (`entities.records.<entityId>.view|manage`) are accepted by shape. Super-administrator roles are omitted from `rolesThatWouldGrant` for callers who are not super administrators.',
      query: accessExplainQuerySchema,
      responses: [
        { status: 200, description: 'Access explanation', schema: accessExplainResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid query or a feature id that is not in the ACL catalog (`{ "error": "unknown_feature" }`)', schema: explainErrorSchema },
        { status: 401, description: 'Authentication required', schema: explainErrorSchema },
        { status: 403, description: 'No resolved tenant, or explaining another user without `insights.explain.access_detail` and `auth.users.list`', schema: explainErrorSchema },
        { status: 404, description: 'The user is not visible in the caller\'s tenant or organization scope (`{ "error": "not_found" }`)', schema: explainErrorSchema },
      ],
    },
  },
}
