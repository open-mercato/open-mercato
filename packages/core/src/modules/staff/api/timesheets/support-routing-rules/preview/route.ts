import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { StaffTimeProject } from '../../../../data/entities'
import { loadSupportTicketCategories } from '../../../../lib/support/dictionaries'
import {
  loadSupportRoutingRules,
  loadUsableSupportProjectIds,
  resolveSupportRouteFromRules,
} from '../../../../lib/support/routing'

const logger = createLogger('staff').child({ component: 'api/timesheets/support-routing-rules/preview' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.timesheets.settings.manage'] },
}

type RuleProblem = 'paused' | 'project_unusable' | 'category_missing' | null

export async function GET(req: Request): Promise<Response> {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope?.tenantId ?? auth.tenantId ?? null
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(400, { error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.') })
    }
    const supportScope = { tenantId, organizationId }
    const em = (container.resolve('em') as EntityManager).fork()
    const [categories, rules] = await Promise.all([
      loadSupportTicketCategories(em, supportScope),
      loadSupportRoutingRules(em, supportScope),
    ])
    const projectIds = rules.map((rule) => rule.timeProjectId)
    const usable = await loadUsableSupportProjectIds(em, supportScope, projectIds)
    const projects = projectIds.length
      ? await em.find(
          StaffTimeProject,
          { id: { $in: Array.from(new Set(projectIds)) }, tenantId, organizationId },
          { fields: ['id', 'name', 'code', 'status', 'deletedAt'] },
        )
      : []
    const projectById = new Map(projects.map((project) => [project.id, project]))
    const categoryValues = new Set(categories.map((category) => category.value))
    const fallbackRule = rules.find((rule) => rule.categoryValue === null) ?? null

    const describeProject = (id: string) => {
      const project = projectById.get(id)
      return {
        id,
        name: project?.name ?? null,
        code: project?.code ?? null,
        status: project && !project.deletedAt ? project.status : 'deleted',
        usable: usable.has(id),
      }
    }

    const ruleViews = rules.map((rule) => {
      let problem: RuleProblem = null
      if (rule.categoryValue !== null) {
        if (!categoryValues.has(rule.categoryValue)) problem = 'category_missing'
        else if (!rule.isActive) problem = 'paused'
        else if (!usable.has(rule.timeProjectId)) problem = 'project_unusable'
      } else if (!usable.has(rule.timeProjectId)) {
        problem = 'project_unusable'
      }
      return {
        id: rule.id,
        categoryValue: rule.categoryValue,
        isActive: rule.isActive,
        isFallback: rule.categoryValue === null,
        project: describeProject(rule.timeProjectId),
        problem,
      }
    })

    const categoryViews = categories.map((category) => {
      const route = resolveSupportRouteFromRules(rules, category.value, usable)
      return {
        value: category.value,
        label: category.label,
        route: route ? { via: route.via, project: describeProject(route.timeProjectId) } : null,
      }
    })

    return NextResponse.json({
      fallback: fallbackRule
        ? { ruleId: fallbackRule.id, project: describeProject(fallbackRule.timeProjectId) }
        : null,
      rules: ruleViews,
      categories: categoryViews,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    logger.error('staff.support.routing preview failed', { err })
    return NextResponse.json({ error: translate('staff.errors.internal', 'Internal server error') }, { status: 500 })
  }
}

const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  code: z.string().nullable(),
  status: z.string(),
  usable: z.boolean(),
})

const previewSchema = z.object({
  fallback: z.object({ ruleId: z.string().uuid(), project: projectSchema }).nullable(),
  rules: z.array(
    z.object({
      id: z.string().uuid(),
      categoryValue: z.string().nullable(),
      isActive: z.boolean(),
      isFallback: z.boolean(),
      project: projectSchema,
      problem: z.enum(['paused', 'project_unusable', 'category_missing']).nullable(),
    }),
  ),
  categories: z.array(
    z.object({
      value: z.string(),
      label: z.string(),
      route: z.object({ via: z.enum(['category', 'fallback']), project: projectSchema }).nullable(),
    }),
  ),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Preview support ticket routing',
  methods: {
    GET: {
      summary: 'Preview support ticket routing',
      description:
        'Returns the fallback rule, every routing rule with the problem that makes it fall back (paused, unusable project, deleted category), and the project each support category routes to right now.',
      responses: [{ status: 200, description: 'Routing preview', schema: previewSchema }],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing staff.timesheets.settings.manage' },
      ],
    },
  },
}
