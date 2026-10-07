import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { MarketingScoreRule } from '../../data/entities.js'
import { scoreRuleCreateSchema } from '../../data/validators.js'
import { isForbiddenRuleExpression } from '../../lib/score-rules.js'
import { forbiddenExpressionResponseBody, presentScoreRule, queueRecompute } from './shared.js'

/**
 * Score rules: list and create.
 *
 * A rule awards points for a standing fact about a customer. Creating one queues a pass over every customer, so
 * the points appear without anybody having to touch a record.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.view'] },
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

const MAX_PAGE_SIZE = 100

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ items: [], total: 0 }, { status: 401 })
  /**
   * A scope that cannot be resolved is a 400, never a 401.
   *
   * `apiFetch` reads 401 as an expired session: it refreshes, succeeds, returns to the same page and
   * refreshes again — so answering 401 for "All organizations" did not fail, it looped for ever. The
   * resolver also recovers the actor's own organization where that is still the actor's tenant, which is
   * what keeps a super-admin's own configuration visible instead of unreachable.
   */
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()

  const url = new URL(req.url)
  const pageSize = Math.min(Math.max(Number.parseInt(url.searchParams.get('pageSize') ?? '50', 10) || 50, 1), MAX_PAGE_SIZE)
  const page = Math.max(Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1, 1)

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }

  const [items, total] = await em.findAndCount(
    MarketingScoreRule,
    { ...scope, deletedAt: null },
    { orderBy: { name: 'ASC', id: 'ASC' }, limit: pageSize, offset: (page - 1) * pageSize },
  )
  return NextResponse.json({ items: items.map(presentScoreRule), total, page, pageSize })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // A scope that cannot be resolved is a 400, never a 401: `apiFetch` reads 401 as an expired session and
  // loops. See the first guard in this file.
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()

  const parsed = scoreRuleCreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      {
        error: issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid payload',
        code: 'marketing_automation.validation.invalidPayload',
      },
      { status: 400 },
    )
  }
  if (isForbiddenRuleExpression(parsed.data.expression)) {
    return NextResponse.json(forbiddenExpressionResponseBody, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }

  const rule = em.create(MarketingScoreRule, {
    ...scope,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    expression: (parsed.data.expression ?? null) as Record<string, unknown> | null,
    points: parsed.data.points,
    isEnabled: parsed.data.isEnabled ?? true,
  })
  em.persist(rule)
  await em.flush()

  await queueRecompute(scope)
  return NextResponse.json(presentScoreRule(rule))
}

export const openApi = {
  GET: {
    summary: 'List score rules',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Score rules' } },
  },
  POST: {
    summary: 'Create a score rule',
    description: 'The condition is a segment expression and may not read `score` or `segments`. Creating a rule queues a pass that applies it to every customer.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The rule' }, 400: { description: 'Invalid, or reads score or segments' } },
  },
}
