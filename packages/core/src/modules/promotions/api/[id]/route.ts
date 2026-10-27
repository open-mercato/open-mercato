import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isExplicitlyEmptyOrganizationScope } from '@open-mercato/shared/lib/auth/organizationScope'
import { isOrganizationReadAccessAllowed } from '@open-mercato/core/modules/directory/utils/organizationScopeGuard'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, notFound, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Promotion, RuleGroup, Rule, Benefit } from '../../data/entities'

const logger = createLogger('promotions')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['promotions.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

// §API Contracts `GET /api/promotions/[id]`: "recursive eager load, depth-limited to 10
// levels". Phase 1's write paths (`commands/rule-tree.ts`) do not themselves enforce a
// tree-depth cap, so this read-side guard is the only backstop against a pathological or
// corrupted tree inflating the response or recursing without bound — root = depth 0, so a
// child discovered at depth 9 is still included but its own children are not descended
// into, capping the tree at 10 levels total.
const MAX_TREE_DEPTH = 10

const ruleResponseSchema = z.object({
  id: z.string().uuid(),
  ruleType: z.string(),
  config: z.record(z.string(), z.unknown()),
  sortOrder: z.number(),
})

const benefitResponseSchema = z.object({
  id: z.string().uuid(),
  benefitType: z.string(),
  appliesTo: z.string(),
  config: z.record(z.string(), z.unknown()),
  sortOrder: z.number(),
})

type RuleGroupTreeNode = {
  id: string
  operator: string
  sortOrder: number
  rules: z.infer<typeof ruleResponseSchema>[]
  benefits: z.infer<typeof benefitResponseSchema>[]
  children: RuleGroupTreeNode[]
}

const ruleGroupTreeNodeResponseSchema: z.ZodType<RuleGroupTreeNode> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    operator: z.string(),
    sortOrder: z.number(),
    rules: z.array(ruleResponseSchema),
    benefits: z.array(benefitResponseSchema),
    children: z.array(ruleGroupTreeNodeResponseSchema),
  }),
)

const promotionDetailResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  tenantId: z.string().uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  order: z.number(),
  active: z.boolean(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  cumulative: z.boolean(),
  tags: z.array(z.string()),
  excludedTags: z.array(z.string()),
  excludeFlags: z.record(z.string(), z.boolean()),
  eligibleCurrencies: z.array(z.string()),
  maxBudget: z.string().nullable(),
  budgetCurrency: z.string().nullable(),
  ruleGroupId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  ruleGroupTree: ruleGroupTreeNodeResponseSchema.nullable(),
})

function buildRuleGroupTree(
  groupId: string,
  groupsById: Map<string, RuleGroup>,
  childrenByParent: Map<string, RuleGroup[]>,
  rulesByGroup: Map<string, Rule[]>,
  benefitsByGroup: Map<string, Benefit[]>,
  depth: number,
): RuleGroupTreeNode {
  const group = groupsById.get(groupId)
  if (!group) throw new Error('[internal] rule group missing from preloaded map while building tree')

  const rules = (rulesByGroup.get(groupId) ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((rule) => ({ id: rule.id, ruleType: rule.ruleType, config: rule.config, sortOrder: rule.sortOrder }))

  const benefits = (benefitsByGroup.get(groupId) ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((benefit) => ({
      id: benefit.id,
      benefitType: benefit.benefitType,
      appliesTo: benefit.appliesTo,
      config: benefit.config,
      sortOrder: benefit.sortOrder,
    }))

  const children =
    depth >= MAX_TREE_DEPTH - 1
      ? []
      : (childrenByParent.get(groupId) ?? [])
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((child) => buildRuleGroupTree(child.id, groupsById, childrenByParent, rulesByGroup, benefitsByGroup, depth + 1))

  return { id: group.id, operator: group.operator, sortOrder: group.sortOrder, rules, benefits, children }
}

async function loadRuleGroupTree(em: EntityManager, promotion: Promotion): Promise<RuleGroupTreeNode | null> {
  const scopeFilter = { promotionId: promotion.id, tenantId: promotion.tenantId, organizationId: promotion.organizationId }
  const [groups, rules, benefits] = await Promise.all([
    em.find(RuleGroup, scopeFilter),
    em.find(Rule, scopeFilter),
    em.find(Benefit, scopeFilter),
  ])
  if (!groups.length) return null

  const groupsById = new Map(groups.map((group) => [group.id, group]))
  const childrenByParent = new Map<string, RuleGroup[]>()
  for (const group of groups) {
    if (!group.parentRuleGroupId) continue
    const bucket = childrenByParent.get(group.parentRuleGroupId) ?? []
    bucket.push(group)
    childrenByParent.set(group.parentRuleGroupId, bucket)
  }
  const rulesByGroup = new Map<string, Rule[]>()
  for (const rule of rules) {
    const bucket = rulesByGroup.get(rule.ruleGroupId) ?? []
    bucket.push(rule)
    rulesByGroup.set(rule.ruleGroupId, bucket)
  }
  const benefitsByGroup = new Map<string, Benefit[]>()
  for (const benefit of benefits) {
    const bucket = benefitsByGroup.get(benefit.ruleGroupId) ?? []
    bucket.push(benefit)
    benefitsByGroup.set(benefit.ruleGroupId, bucket)
  }

  // Root is identified by `parentRuleGroupId IS NULL` (§Data Models rev W5a), never by
  // `Promotion.ruleGroupId` — the two are expected to agree once creation finishes, but
  // the parent-pointer invariant is the authoritative one `commands/promotions.ts` and
  // `commands/rule-tree.ts` both rely on.
  const rootGroup = groups.find((group) => !group.parentRuleGroupId) ?? groups.find((group) => group.id === promotion.ruleGroupId)
  if (!rootGroup) return null

  return buildRuleGroupTree(rootGroup.id, groupsById, childrenByParent, rulesByGroup, benefitsByGroup, 0)
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = paramsSchema.parse(await params)
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth?.tenantId) {
      throw new CrudHttpError(401, { error: translate('promotions.errors.unauthorized', 'Unauthorized') })
    }
    const authenticatedAuth = auth as typeof auth & { tenantId: string }

    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth: authenticatedAuth, request: req })
    // An explicitly empty organization scope is deny-all — answer not-found rather than a
    // 403 so a cross-tenant/cross-org probe cannot distinguish "exists but denied" from
    // "does not exist" (§API Contracts: "a mismatch answers identically to 'not found' —
    // no cross-tenant existence oracle").
    if (isExplicitlyEmptyOrganizationScope(scope)) {
      throw notFound(translate('promotions.errors.not_found', 'Promotion not found'))
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const promotion = await em.findOne(Promotion, { id, tenantId: authenticatedAuth.tenantId, deletedAt: null })
    if (!promotion) {
      throw notFound(translate('promotions.errors.not_found', 'Promotion not found'))
    }
    if (!isOrganizationReadAccessAllowed({ scope, auth: authenticatedAuth, organizationId: promotion.organizationId })) {
      throw notFound(translate('promotions.errors.not_found', 'Promotion not found'))
    }

    const ruleGroupTree = await loadRuleGroupTree(em, promotion)

    const payload: z.infer<typeof promotionDetailResponseSchema> = {
      id: promotion.id,
      organizationId: promotion.organizationId ?? null,
      tenantId: promotion.tenantId ?? null,
      name: promotion.name,
      description: promotion.description ?? null,
      order: promotion.order,
      active: promotion.active,
      startsAt: promotion.startsAt ? promotion.startsAt.toISOString() : null,
      endsAt: promotion.endsAt ? promotion.endsAt.toISOString() : null,
      cumulative: promotion.cumulative,
      tags: [...promotion.tags],
      excludedTags: [...promotion.excludedTags],
      excludeFlags: { ...promotion.excludeFlags },
      eligibleCurrencies: [...promotion.eligibleCurrencies],
      maxBudget: promotion.maxBudget ?? null,
      budgetCurrency: promotion.budgetCurrency ?? null,
      ruleGroupId: promotion.ruleGroupId ?? null,
      createdAt: promotion.createdAt.toISOString(),
      updatedAt: promotion.updatedAt.toISOString(),
      ruleGroupTree,
    }

    return NextResponse.json(payload)
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) {
      return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    }
    logger.error('promotions.detail.get failed', { err })
    return NextResponse.json(
      { error: translate('promotions.errors.load_failed', 'Failed to load the promotion') },
      { status: 400 },
    )
  }
}

// Hand-rolled (not built through `api/openapi.ts`'s `createCrudOpenApiFactory`): that
// factory always shapes its `GET` as the paginated LIST endpoint (`query: querySchema`,
// `listResponseSchema`) per `packages/shared/src/lib/openapi/crud.ts` — there is no
// detail-by-path-param shape in it. This route returns one record plus a nested tree, so
// it documents itself directly, the same way Step 1.4's custom (non-CRUD) routes
// (`[id]/tree/route.ts`, `order/route.ts`) do.
export const openApi: OpenApiRouteDoc = {
  tag: 'Promotions',
  summary: 'Fetch a single promotion with its rule group tree',
  methods: {
    GET: {
      summary: 'Get promotion detail',
      description:
        'Returns the promotion plus its rule group tree, recursively eager-loaded and depth-limited to 10 levels. Carries `updatedAt` for optimistic-lock headers.',
      responses: [
        { status: 200, description: 'Promotion detail', schema: promotionDetailResponseSchema },
        { status: 404, description: 'Promotion not found (or not visible to the caller)' },
      ],
    },
  },
}
