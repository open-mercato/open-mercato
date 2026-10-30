import type { AwilixContainer } from 'awilix'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { MarketingScoreRule } from '../../../data/entities.js'
import { scoreRuleUpdateSchema } from '../../../data/validators.js'
import { isForbiddenRuleExpression } from '../../../lib/score-rules.js'
import { readPathUuid } from '../../shared.js'
import { forbiddenExpressionResponseBody, presentScoreRule, queueRecompute } from '../shared.js'

/**
 * One score rule: read, edit, remove.
 *
 * Every write queues the pass that applies it. Removing a rule takes its points back from everybody who had them,
 * which is what "this fact no longer earns points" means.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.view'] },
  PUT: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

async function load(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  /**
   * A scope that cannot be resolved is a 400, never a 401.
   *
   * `apiFetch` reads 401 as an expired session: it refreshes, succeeds, returns to the same page and
   * refreshes again — so answering 401 for "All organizations" did not fail, it looped for ever. The
   * resolver also recovers the actor's own organization where that is still the actor's tenant, which is
   * what keeps a super-admin's own configuration visible instead of unreachable.
   */
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return { error: organizationScopeRequiredResponse() }
  const id = readPathUuid(req, 1)
  if (!id) return { error: NextResponse.json({ error: 'Missing id' }, { status: 400 }) }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }
  const rule = await em.findOne(MarketingScoreRule, { id, ...scope, deletedAt: null })
  if (!rule) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  // The container travels with the loaded record so the guarded lock seam can reach the optional enterprise
  // `record_locks` service through DI — the OSS floor alone would leave this module outside that guard.
  return { em, rule, scope, container }
}

async function lock(
  container: AwilixContainer,
  req: Request,
  rule: MarketingScoreRule,
  expected: string | undefined,
): Promise<NextResponse | null> {
  try {
    await enforceCommandOptimisticLockWithGuards(container, {
      resourceKind: 'marketing_automation.score_rule',
      resourceId: rule.id,
      current: rule.updatedAt,
      expected,
      request: req,
    })
    return null
  } catch (error) {
    if (error instanceof CrudHttpError) return NextResponse.json(error.body, { status: error.status })
    throw error
  }
}

export async function GET(req: Request) {
  const loaded = await load(req)
  if ('error' in loaded) return loaded.error
  return NextResponse.json(presentScoreRule(loaded.rule))
}

export async function PUT(req: Request) {
  const parsed = scoreRuleUpdateSchema.safeParse(await req.json().catch(() => null))
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
  if (parsed.data.expression !== undefined && isForbiddenRuleExpression(parsed.data.expression)) {
    return NextResponse.json(forbiddenExpressionResponseBody, { status: 400 })
  }

  const loaded = await load(req)
  if ('error' in loaded) return loaded.error
  const { em, rule, scope, container } = loaded

  const conflict = await lock(container, req, rule, parsed.data.updatedAt)
  if (conflict) return conflict

  if (parsed.data.name !== undefined) rule.name = parsed.data.name
  if (parsed.data.description !== undefined) rule.description = parsed.data.description
  if (parsed.data.expression !== undefined) {
    rule.expression = (parsed.data.expression ?? null) as Record<string, unknown> | null
  }
  if (parsed.data.points !== undefined) rule.points = parsed.data.points
  if (parsed.data.isEnabled !== undefined) rule.isEnabled = parsed.data.isEnabled
  await em.flush()

  await queueRecompute(scope)
  return NextResponse.json(presentScoreRule(rule))
}

export async function DELETE(req: Request) {
  const loaded = await load(req)
  if ('error' in loaded) return loaded.error
  const { em, rule, scope, container } = loaded

  const conflict = await lock(container, req, rule, undefined)
  if (conflict) return conflict

  rule.deletedAt = new Date()
  await em.flush()

  await queueRecompute(scope)
  return NextResponse.json({ ok: true })
}

export const openApi = {
  GET: { summary: 'Read a score rule', tags: ['Marketing Automation'], responses: { 200: { description: 'The rule' } } },
  PUT: {
    summary: 'Update a score rule',
    description: 'Queues a pass that applies the change to every customer.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Updated' }, 400: { description: 'Invalid' }, 409: { description: 'Changed since it was read' } },
  },
  DELETE: {
    summary: 'Remove a score rule',
    description: 'Soft delete. The pass it queues takes the rule\'s points back from everybody who had them.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Removed' } },
  },
}
