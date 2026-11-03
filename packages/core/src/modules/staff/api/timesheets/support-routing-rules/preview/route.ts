import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { StaffTimeProject } from '../../../../data/entities'
import { resolveAssignmentGraceDaysFromContainer } from '../../../../lib/time-tracking/projectAssignment'
import { projectReachesRecipientBeforeManagers } from '../../../../lib/time-tracking/workRecipients'
import { loadSupportTicketCategories } from '../../../../lib/support/dictionaries'
import {
  loadSupportRoutingRules,
  loadUsableSupportProjectIds,
  resolveSupportRouteFromRules,
  type SupportRoutingRuleView,
} from '../../../../lib/support/routing'

const logger = createLogger('staff').child({ component: 'api/timesheets/support-routing-rules/preview' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.timesheets.settings.manage'] },
}

type RuleProblem = 'paused' | 'project_unusable' | 'category_missing' | null

type UnnotifiedCountDb = {
  staff_support_tickets: {
    task_id: string
    tenant_id: string
    organization_id: string
    unnotified_at: Date | null
    deleted_at: Date | null
  }
  staff_time_tasks: {
    id: string
    tenant_id: string
    organization_id: string
    time_project_id: string
    source: string
    deleted_at: Date | null
  }
}

async function countUnnotifiedTicketsByProject(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<Map<string, number>> {
  const rows = await em
    .getKysely<UnnotifiedCountDb>()
    .selectFrom('staff_support_tickets')
    .innerJoin('staff_time_tasks', 'staff_time_tasks.id', 'staff_support_tickets.task_id')
    .select(['staff_time_tasks.time_project_id as time_project_id'])
    .select((builder) => builder.fn.countAll<string | number>().as('ticket_count'))
    .where('staff_support_tickets.tenant_id', '=', scope.tenantId)
    .where('staff_support_tickets.organization_id', '=', scope.organizationId)
    .where('staff_support_tickets.deleted_at', 'is', null)
    .where('staff_support_tickets.unnotified_at', 'is not', null)
    .where('staff_time_tasks.tenant_id', '=', scope.tenantId)
    .where('staff_time_tasks.organization_id', '=', scope.organizationId)
    .where('staff_time_tasks.source', '=', 'portal')
    .where('staff_time_tasks.deleted_at', 'is', null)
    .groupBy('staff_time_tasks.time_project_id')
    .execute()
  const counts = new Map<string, number>()
  for (const row of rows) {
    const count = Number(row.ticket_count)
    if (Number.isFinite(count) && count > 0) counts.set(row.time_project_id, count)
  }
  return counts
}

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
          { fields: ['id', 'name', 'code', 'status', 'deletedAt', 'ownerUserId', 'defaultAssigneeStaffMemberId'] },
        )
      : []
    const projectById = new Map(projects.map((project) => [project.id, project]))
    const graceDays = await resolveAssignmentGraceDaysFromContainer(container, tenantId)
    const [unnotifiedByProject, reachability] = await Promise.all([
      countUnnotifiedTicketsByProject(em.fork(), supportScope),
      Promise.all(
        projects.map(async (project) => {
          if (project.deletedAt) return [project.id, true] as const
          const reaches = await projectReachesRecipientBeforeManagers(em.fork(), supportScope, project, { graceDays })
          return [project.id, reaches] as const
        }),
      ),
    ])
    const reachesById = new Map<string, boolean>(reachability)
    let unnotifiedTicketCount = 0
    for (const count of unnotifiedByProject.values()) unnotifiedTicketCount += count
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
        nobodyNotified: usable.has(id) && reachesById.get(id) === false,
        unnotifiedTicketCount: unnotifiedByProject.get(id) ?? 0,
      }
    }

    const ruleVersion = (rule: SupportRoutingRuleView): string | null =>
      rule.updatedAt instanceof Date ? rule.updatedAt.toISOString() : null

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
        updatedAt: ruleVersion(rule),
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
        ? { ruleId: fallbackRule.id, project: describeProject(fallbackRule.timeProjectId), updatedAt: ruleVersion(fallbackRule) }
        : null,
      rules: ruleViews,
      categories: categoryViews,
      unnotifiedTicketCount,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    logger.error('staff.support.routing preview failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.support_routing_preview_failed' })
    return NextResponse.json({ error: translate('staff.errors.internal', 'Internal server error') }, { status: 500 })
  }
}

const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  code: z.string().nullable(),
  status: z.string(),
  usable: z.boolean(),
  nobodyNotified: z
    .boolean()
    .optional()
    .describe('True for a usable project with no active assigner, no usable default assignee and no owner: new-ticket notifications fall through to the organization project managers'),
  unnotifiedTicketCount: z
    .number()
    .int()
    .optional()
    .describe('Live portal tickets in this project whose support notification reached nobody (`unnotified_at` set)'),
})

const ruleVersionSchema = z
  .string()
  .nullable()
  .describe('The rule `updated_at` read in the same snapshot as its values; send it as the optimistic-lock expected version when editing or deleting the rule')

const previewSchema = z.object({
  fallback: z.object({ ruleId: z.string().uuid(), project: projectSchema, updatedAt: ruleVersionSchema }).nullable(),
  rules: z.array(
    z.object({
      id: z.string().uuid(),
      categoryValue: z.string().nullable(),
      isActive: z.boolean(),
      isFallback: z.boolean(),
      project: projectSchema,
      problem: z.enum(['paused', 'project_unusable', 'category_missing']).nullable(),
      updatedAt: ruleVersionSchema,
    }),
  ),
  categories: z.array(
    z.object({
      value: z.string(),
      label: z.string(),
      route: z.object({ via: z.enum(['category', 'fallback']), project: projectSchema }).nullable(),
    }),
  ),
  unnotifiedTicketCount: z
    .number()
    .int()
    .optional()
    .describe('Live portal tickets in the organization whose support notification reached nobody (`unnotified_at` set)'),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Preview support ticket routing',
  methods: {
    GET: {
      summary: 'Preview support ticket routing',
      description:
        'Returns the fallback rule, every routing rule with the problem that makes it fall back (paused, unusable project, deleted category), the project each support category routes to right now, which routing targets would notify nobody before the organization project managers (`project.nobodyNotified`), how many live tickets were not notified to anyone (`project.unnotifiedTicketCount`, `unnotifiedTicketCount`), and each rule `updatedAt` version token read together with its values.',
      responses: [{ status: 200, description: 'Routing preview', schema: previewSchema }],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing staff.timesheets.settings.manage' },
      ],
    },
  },
}
