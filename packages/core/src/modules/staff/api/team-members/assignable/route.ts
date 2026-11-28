import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createPagedListResponseSchema as createSharedPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import {
  resolveAuthActorId,
  resolveCustomersRequestContext,
  type CustomersRequestContext,
} from '@open-mercato/core/modules/customers/lib/interactionRequestContext'
import { StaffTeam, StaffTeamMember } from '../../../data/entities'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('staff')

const querySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(24),
    search: z.string().optional(),
  })
  .passthrough()

const itemSchema = z.object({
  id: z.string().uuid(),
  teamMemberId: z.string().uuid(),
  userId: z.string().uuid(),
  displayName: z.string(),
  email: z.string().nullable().optional(),
  teamName: z.string().nullable().optional(),
  user: z
    .object({
      id: z.string().uuid(),
      email: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  team: z
    .object({
      id: z.string().uuid(),
      name: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
})

const errorSchema = z.object({ error: z.string() })

const pagedListSchema = createSharedPagedListResponseSchema(itemSchema, {
  paginationMetaOptional: true,
})

export const metadata = {
  GET: { requireAuth: true },
}

const assignableStaffFeatureAlternatives = [
  ['customers.roles.view', 'customers.roles.manage'],
  ['customers.roles.view', 'customers.activities.manage'],
  ['customers.interactions.manage'],
]

async function resolveAssignableStaffFilter(
  context: CustomersRequestContext,
  request: Request,
  rbac: RbacService | undefined,
): Promise<ReturnType<typeof resolveOrganizationScopeFilter>['where'] | null> {
  if (!rbac) return null
  const { auth, container, em, scope } = context
  const actorId = resolveAuthActorId(auth)
  const orgFilter = resolveOrganizationScopeFilter(scope, auth)
  const tenantId = auth.tenantId

  if (scope.selectedId) {
    for (const features of assignableStaffFeatureAlternatives) {
      if (await rbac.userHasAllFeatures(actorId, features, { tenantId, organizationId: scope.selectedId })) {
        return orgFilter.where
      }
    }
    return null
  }

  if (orgFilter.organizationIds?.length === 0) return null
  const calendarAccess = await rbac.resolveFeatureOrganizationAccess(actorId, ['customers.interactions.manage'], { tenantId })
  if (calendarAccess.unrestricted) return orgFilter.where

  const legacyView = await resolveFeatureCheckContext({
    container, auth, request, requiredFeatures: ['customers.roles.view'],
  })
  const legacyFilter = resolveOrganizationScopeFilter(legacyView.scope, auth)
  const canViewRoles = await rbac.userHasAllFeatures(actorId, ['customers.roles.view'], {
    tenantId: legacyView.scope.tenantId ?? tenantId,
    organizationId: legacyView.organizationId,
  })
  const legacyScope = { tenantId, organizationId: legacyFilter.rbacOrganizationId }
  const canUseLegacyRoster = canViewRoles && (
    await rbac.userHasAllFeatures(actorId, ['customers.roles.manage'], legacyScope)
    || await rbac.userHasAllFeatures(actorId, ['customers.activities.manage'], legacyScope)
  )
  if (canUseLegacyRoster && !legacyFilter.organizationIds) {
    return orgFilter.where
  }

  const organizations = await findWithDecryption(
    em,
    Organization,
    { tenant: tenantId, deletedAt: null, ...(orgFilter.organizationIds ? { id: { $in: orgFilter.organizationIds } } : {}) },
    { fields: ['id', 'ancestorIds'] },
    { tenantId, organizationId: null },
  )
  const permittedIds = new Set(calendarAccess.filterOrganizationIds(organizations))
  if (canUseLegacyRoster) {
    for (const organizationId of legacyFilter.organizationIds ?? []) permittedIds.add(organizationId)
  }
  const organizationIds = organizations.map(({ id }) => id).filter((id) => permittedIds.has(id))
  return organizationIds.length || canUseLegacyRoster ? { organizationId: { $in: organizationIds } } : null
}

export async function GET(request: Request) {
  const { translate } = await resolveTranslations()
  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const context = await resolveCustomersRequestContext(request)
    const { container, em, auth, scope: organizationScope } = context
    const rbacService = container.resolve('rbacService') as RbacService | undefined
    const organizationFilter = await resolveAssignableStaffFilter(context, request, rbacService)
    if (!organizationFilter) {
      throw new CrudHttpError(
        403,
        {
          error: translate(
            'customers.assignableStaff.forbidden',
            'Insufficient permissions to load assignable staff.',
          ),
        },
      )
    }

    const scope = { tenantId: auth.tenantId, organizationId: resolveOrganizationScopeFilter(organizationScope, auth).rbacOrganizationId }
    const normalizedSearch = query.search?.trim().toLowerCase() ?? ''

    const members = await findWithDecryption(
      em,
      StaffTeamMember,
      {
        tenantId: auth.tenantId,
        ...organizationFilter,
        deletedAt: null,
        isActive: true,
      },
      { orderBy: { displayName: 'asc' } },
      scope,
    )

    const userIds = Array.from(
      new Set(
        members
          .map((member) => (typeof member.userId === 'string' && member.userId.trim().length > 0 ? member.userId : null))
          .filter((value): value is string => typeof value === 'string'),
      ),
    )
    const teamIds = Array.from(
      new Set(
        members
          .map((member) => (typeof member.teamId === 'string' && member.teamId.trim().length > 0 ? member.teamId : null))
          .filter((value): value is string => typeof value === 'string'),
      ),
    )

    const [users, teams] = await Promise.all([
      userIds.length > 0
        ? findWithDecryption(
            em,
            User,
            {
              id: { $in: userIds },
              deletedAt: null,
              tenantId: auth.tenantId,
              ...organizationFilter,
            },
            undefined,
            scope,
          )
        : Promise.resolve([]),
      teamIds.length > 0
        ? findWithDecryption(
            em,
            StaffTeam,
            {
              id: { $in: teamIds },
              deletedAt: null,
              tenantId: auth.tenantId,
              ...organizationFilter,
            },
            undefined,
            scope,
          )
        : Promise.resolve([]),
    ])

    const userById = new Map(
      users.map((user) => [
        user.id,
        {
          id: user.id,
          email: user.email ?? null,
        },
      ]),
    )
    const teamById = new Map(
      teams.map((team) => [
        team.id,
        {
          id: team.id,
          name: team.name ?? null,
        },
      ]),
    )

    const items = members
      .filter((member) => typeof member.userId === 'string' && member.userId.trim().length > 0)
      .map((member) => {
        const userId = member.userId as string
        const user = userById.get(userId) ?? { id: userId, email: null }
        const team = member.teamId ? teamById.get(member.teamId) ?? null : null
        return {
          id: member.id,
          teamMemberId: member.id,
          userId,
          displayName: member.displayName?.trim() || user.email || userId,
          email: user.email,
          teamName: team?.name ?? null,
          user,
          team,
        }
      })
      .filter((item) => {
        if (!normalizedSearch) return true
        const haystack = [item.displayName, item.email, item.teamName]
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join(' ')
          .toLowerCase()
        return haystack.includes(normalizedSearch)
      })

    const deduped = Array.from(
      items.reduce((acc, item) => {
        if (!acc.has(item.userId)) {
          acc.set(item.userId, item)
        }
        return acc
      }, new Map<string, (typeof items)[number]>()),
    ).map(([, item]) => item)

    const start = (query.page - 1) * query.pageSize
    return NextResponse.json({
      items: deduped.slice(start, start + query.pageSize),
      total: deduped.length,
      page: query.page,
      pageSize: query.pageSize,
    })
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: translate('customers.errors.validationFailed', 'Validation failed') }, { status: 400 })
    }
    logger.error('staff.assignable-team-members.get failed', { err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'staff', code: 'staff.assignable_team_members_load_failed' })
    return NextResponse.json({ error: translate('customers.errors.assignable_staff_load_failed', 'Failed to load assignable staff') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Assignable staff candidates',
  methods: {
    GET: {
      summary: 'List staff members that can be assigned from customer flows',
      query: querySchema,
      description:
        'Returns active staff members linked to auth users in authorized organizations. Requires customers.interactions.manage, or customers.roles.view with either customers.roles.manage or customers.activities.manage. Owned by the staff module and replaces the deprecated /api/customers/assignable-staff route.',
      responses: [
        {
          status: 200,
          description: 'Assignable staff members',
          schema: pagedListSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid request', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Forbidden', schema: errorSchema },
      ],
    },
  },
}
