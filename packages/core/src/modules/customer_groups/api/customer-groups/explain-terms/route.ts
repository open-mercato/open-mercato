import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { CustomerGroup } from '../../../data/entities'
import {
  loadCustomerGroupAncestorChain,
  type CustomerGroupsService,
  type ResolvedTerms,
  type ResolvedTermsSources,
} from '../../../services/customerGroupsService'

const logger = createLogger('customer_groups')

// No mutation, so no mutation-guard wiring — mirrors `reconcile/route.ts`'s GET.
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customer_groups.terms.view'] },
}

// Local duplicate of the service's own (unexported) `TERMS_FIELD_NAMES` — `satisfies`
// pins it to `ResolvedTermsSources`'s keys so a future terms field addition fails this
// file's typecheck instead of silently omitting itself from the explain-terms response.
const TERMS_FIELDS = [
  'priceKindId',
  'paymentTermsDays',
  'allowPurchaseOnAccount',
  'approvalRequiredAbove',
  'minOrderValue',
] as const satisfies readonly (keyof ResolvedTermsSources)[]

type TermsField = (typeof TERMS_FIELDS)[number]

const querySchema = z.object({ customerId: z.string().uuid() })

type GroupSummary = { id: string; code: string; name: string }

type ExplainTermsField = {
  value: string | number | boolean | null
  sourceGroupId: string | null
  path: GroupSummary[]
}

type ExplainTermsResponse = {
  groups: GroupSummary[]
  fields: Record<TermsField, ExplainTermsField>
}

function toGroupSummary(group: CustomerGroup): GroupSummary {
  return { id: group.id, code: group.code, name: group.name }
}

// Reconstructs the visible ancestor path for one resolved field: `resolveTerms`
// resolves each field by walking `chains` in priority order and, within each chain,
// self → parent → ... , stopping at the first group with that field set — so the
// first chain (in the same priority order) whose own lineage contains
// `sourceGroupId` is always the chain `resolveTerms` actually resolved that field
// from. The path is that chain sliced down to (and including) `sourceGroupId`.
function buildAncestorPath(chains: CustomerGroup[][], sourceGroupId: string | null): GroupSummary[] {
  if (sourceGroupId == null) return []
  for (const chain of chains) {
    const index = chain.findIndex((group) => group.id === sourceGroupId)
    if (index !== -1) return chain.slice(0, index + 1).map(toGroupSummary)
  }
  return []
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth) throw new CrudHttpError(401, { error: translate('customer_groups.errors.unauthorized', 'Unauthorized') })
    const tenantId = auth.tenantId ?? null
    if (!tenantId) {
      return NextResponse.json(
        { error: translate('customer_groups.errors.tenant_required', 'Tenant context is required') },
        { status: 400 },
      )
    }

    const url = new URL(req.url)
    const parsedQuery = querySchema.safeParse({ customerId: url.searchParams.get('customerId') ?? undefined })
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: translate('customer_groups.errors.invalid_input', 'Invalid input') },
        { status: 400 },
      )
    }
    const { customerId } = parsedQuery.data

    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const customerGroupsService = container.resolve<CustomerGroupsService>('customerGroupsService')

    const groupResolution = await customerGroupsService.resolveGroups({ customerId, tenantId })
    const resolvedTerms: ResolvedTerms = await customerGroupsService.resolveTerms({
      customerId,
      tenantId,
      groupIds: groupResolution.groupIds,
    })

    // The FULL `{id,code,name}` ancestor path per field (not just the winning
    // `sourceGroupId`) renders the panel's visible ancestor breadcrumb (spec: "a
    // visible ancestor path (child → parent → tenant), not a hidden tooltip"). Chains
    // come from the service's own `loadCustomerGroupAncestorChain` — the same walk
    // `resolveTerms` uses — so the path shown can never disagree with the value
    // resolved (e.g. both stop at a soft-deleted parent).
    const groupCache = new Map<string, CustomerGroup | null>()
    const chains: CustomerGroup[][] = []
    for (const groupId of groupResolution.groupIds) {
      chains.push(await loadCustomerGroupAncestorChain(em, groupId, tenantId, groupCache))
    }

    const fields = TERMS_FIELDS.reduce<Record<TermsField, ExplainTermsField>>((acc, field) => {
      const sourceGroupId = resolvedTerms.sources[field]
      acc[field] = {
        value: resolvedTerms[field],
        sourceGroupId,
        path: buildAncestorPath(chains, sourceGroupId),
      }
      return acc
    }, {} as Record<TermsField, ExplainTermsField>)

    const response: ExplainTermsResponse = {
      groups: groupResolution.groups.map((group) => ({ id: group.id, code: group.code, name: group.name })),
      fields,
    }

    return NextResponse.json(response)
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('customer_groups.terms.explain failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'customer_groups', code: 'customer_groups.terms_explain_failed' })
    return NextResponse.json(
      { error: translate('customer_groups.errors.load_failed', 'Failed to load commercial terms') },
      { status: 500 },
    )
  }
}

const groupSummarySchema = z.object({ id: z.string().uuid(), code: z.string(), name: z.string() })
const explainTermsFieldSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  sourceGroupId: z.string().uuid().nullable(),
  path: z.array(groupSummarySchema),
})
const explainTermsResponseSchema = z.object({
  groups: z.array(groupSummarySchema),
  fields: z.object({
    priceKindId: explainTermsFieldSchema,
    paymentTermsDays: explainTermsFieldSchema,
    allowPurchaseOnAccount: explainTermsFieldSchema,
    approvalRequiredAbove: explainTermsFieldSchema,
    minOrderValue: explainTermsFieldSchema,
  }),
})
const explainTermsErrorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerGroups',
  summary: 'Explain a customer’s resolved commercial terms',
  methods: {
    GET: {
      summary: 'Explain a customer’s resolved commercial terms',
      description:
        'Resolves the effective commercial terms for a customer and, per field, the group that supplied the value (or tenant default) plus the visible ancestor path (child → parent → tenant) used to find it.',
      query: querySchema,
      responses: [
        { status: 200, description: 'Resolved terms with per-field provenance', schema: explainTermsResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Tenant context is required or customerId is invalid', schema: explainTermsErrorSchema },
        { status: 401, description: 'Unauthorized', schema: explainTermsErrorSchema },
        { status: 500, description: 'Unexpected failure', schema: explainTermsErrorSchema },
      ],
    },
  },
}
