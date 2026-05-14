import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { StaffTimeProjectMember, StaffTeamMember } from '../../../../data/entities'
import { staffMyProjectVisibilityUpdateSchema } from '../../../../data/validators'
import {
  resolveUserFeatures,
  runStaffMutationGuardAfterSuccess,
  runStaffMutationGuards,
} from '../../../guards'

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['staff.timesheets.manage_own'] },
}

function extractProjectIdFromUrl(req: Request): string | null {
  try {
    const url = new URL(req.url)
    const match = url.pathname.match(/\/my-projects\/([^/]+)(?:\/|$)/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * PATCH /api/staff/timesheets/my-projects/{projectId}
 *
 * Self-service endpoint for the authenticated user to toggle visibility of a
 * time project on their own My Timesheets grid. Does not require the admin-only
 * `staff.timesheets.projects.manage` feature — only `staff.timesheets.manage_own`.
 *
 * Added 2026-04-13 to close a gap in the original UX enhancements spec:
 * "+ Add row" and the new X remove button need to persist per-user grid membership.
 */
export async function PATCH(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) {
      throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })
    }

    const projectId = extractProjectIdFromUrl(req)
    if (!projectId || !z.string().uuid().safeParse(projectId).success) {
      throw new CrudHttpError(400, {
        error: translate('staff.timesheets.errors.invalidProjectId', 'Invalid project id.'),
      })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope?.tenantId ?? auth.tenantId ?? null
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(400, {
        error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.'),
      })
    }

    const rawBody = await readJsonSafe(req, {})
    const parsed = staffMyProjectVisibilityUpdateSchema.safeParse(rawBody)
    if (!parsed.success) {
      throw new CrudHttpError(400, {
        error: translate('staff.timesheets.errors.invalidBody', 'Invalid request body.'),
        details: parsed.error.flatten(),
      })
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const scopeCtx = { tenantId, organizationId }

    const staffMember = await findOneWithDecryption(
      em,
      StaffTeamMember,
      { userId: auth.sub, tenantId, organizationId, deletedAt: null },
      {},
      scopeCtx,
    )
    if (!staffMember) {
      throw new CrudHttpError(403, {
        error: translate('staff.timesheets.errors.noStaffMember', 'No staff member linked to your account.'),
      })
    }

    const membership = await findOneWithDecryption(
      em,
      StaffTimeProjectMember,
      {
        timeProjectId: projectId,
        staffMemberId: staffMember.id,
        tenantId,
        organizationId,
        deletedAt: null,
        status: 'active',
      },
      {},
      scopeCtx,
    )
    if (!membership) {
      throw new CrudHttpError(404, {
        error: translate('staff.timesheets.errors.notAssigned', 'You are not assigned to this project.'),
      })
    }

    const guardResult = await runStaffMutationGuards(
      container,
      {
        tenantId,
        organizationId,
        userId: auth.sub ?? '',
        resourceKind: 'staff.timesheets.time_project_member',
        resourceId: membership.id,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
        mutationPayload: parsed.data as unknown as Record<string, unknown>,
      },
      resolveUserFeatures(auth),
    )
    if (!guardResult.ok) {
      return NextResponse.json(
        guardResult.errorBody ?? { error: 'Operation blocked by guard' },
        { status: guardResult.errorStatus ?? 422 },
      )
    }

    membership.showInGrid = parsed.data.showInGrid
    await em.flush()

    if (guardResult.afterSuccessCallbacks.length) {
      await runStaffMutationGuardAfterSuccess(guardResult.afterSuccessCallbacks, {
        tenantId,
        organizationId,
        userId: auth.sub ?? '',
        resourceKind: 'staff.timesheets.time_project_member',
        resourceId: membership.id,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
      })
    }

    return NextResponse.json({ ok: true, showInGrid: membership.showInGrid }, { status: 200 })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('staff.timesheets.my-projects.patch failed', err)
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('staff.timesheets.errors.updateMyProject', 'Failed to update project visibility.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'My project grid visibility',
  methods: {
    PATCH: {
      summary: 'Toggle grid visibility for one of the caller\'s assigned time projects',
      description:
        'Self-service endpoint. Only the authenticated user can toggle `show_in_grid` on their own active membership for the given project. Does not require the admin-only `staff.timesheets.projects.manage` feature.',
      requestBody: {
        contentType: 'application/json',
        schema: staffMyProjectVisibilityUpdateSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Visibility updated',
          schema: z.object({ ok: z.boolean(), showInGrid: z.boolean() }),
        },
        { status: 400, description: 'Invalid input', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'No staff member linked', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Project membership not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
