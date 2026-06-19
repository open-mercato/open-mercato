import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createPagedListResponseSchema as createSharedPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import {
  resolveAuthActorId,
  resolveCustomersRequestContext,
} from '@open-mercato/core/modules/customers/lib/interactionRequestContext'
import { StaffTeam, StaffTeamMember } from '../../../data/entities'

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
  GET: { requireAuth: true, requireFeatures: ['customers.roles.view'] },
}

async function canAccessAssignableStaff(
  rbac: RbacService | undefined,
  userId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<boolean> {
  if (!rbac) return false
  if (
    await rbac.userHasAllFeatures(userId, ['customers.roles.manage'], scope)
  ) {
    return true
  }
  return rbac.userHasAllFeatures(userId, ['customers.activities.manage'], scope)
}

export async function GET(request: Request) {
  const { translate } = await resolveTranslations()
  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const { container, em, auth, selectedOrganizationId } = await resolveCustomersRequestContext(request)

    if (!selectedOrganizationId) {
      throw new CrudHttpError(
        400,
        { error: translate('customers.errors.organization_required', 'Organization context is required') },
      )
    }

    const actorId = resolveAuthActorId(auth)
    const rbacService = container.resolve('rbacService') as RbacService | undefined
    const scope = { tenantId: auth.tenantId, organizationId: selectedOrganizationId }
    const hasAccess = await canAccessAssignableStaff(rbacService, actorId, scope)
    if (!hasAccess) {
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

    const normalizedSearch = query.search?.trim().toLowerCase() ?? ''

    const members = await findWithDecryption(
      em,
      StaffTeamMember,
      {
        tenantId: auth.tenantId,
        organizationId: selectedOrganizationId,
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
              organizationId: selectedOrganizationId,
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
              organizationId: selectedOrganizationId,
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
    console.error('staff.assignable-team-members.get failed', error)
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
        'Returns active staff members linked to auth users. Access requires either customers.roles.manage or customers.activities.manage. Owned by the staff module; consumed from customer flows via this canonical URL. Replaces the deprecated /api/customers/assignable-staff route.',
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
