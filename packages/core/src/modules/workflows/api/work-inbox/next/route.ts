/**
 * Work Inbox — claim-next (spec §6.2: "a one-click claim-next affordance …
 * keeps frontline flow").
 *
 * Endpoints:
 * - POST /api/workflows/work-inbox/next — claim the top claimable item
 *
 * Atomicity: the candidate list is a plain read and is expected to be stale by
 * the time it is used. The claim itself is `taskHandler.claimUserTask`, which
 * takes the row with a conditional `UPDATE … WHERE status = 'PENDING' AND
 * claimed_by IS NULL`. Two operators pressing the button at the same instant
 * therefore see the same candidate list and the loser's update affects zero
 * rows, at which point this handler moves on to the next candidate instead of
 * failing. Nothing about the claim is re-implemented here (module MUST #1).
 *
 * Phase 1 claims workflow tasks only: `taskHandler` is the claim seam for the
 * `user_task` kind, and a provider-generic claim would need each source to
 * expose a server-side claim of its own. Other kinds stay claimable through
 * their own endpoints, which the row's `actions` already advertise.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { USER_TASK_INBOX_KIND } from '../../tasks/serialize'
import { serializeWorkInboxRow } from '../../../lib/work-inbox/provider'
import { parseWorkInboxQuery } from '../../../lib/work-inbox/query'
import { toUserTaskWorkInboxRow } from '../../../lib/work-inbox/user-task-source'
import type { WorkInboxService } from '../../../lib/work-inbox/service'
import type { TaskHandlerService } from '../../../lib/task-handler'
import {
  collectScopedTaskEntityTypes,
  resolveTaskVisibilityForRequest,
} from '../../../lib/task-visibility-request'
import { UserTask } from '../../../data/entities'
import {
  workflowsTag,
  workInboxClaimNextResponseSchema,
  workflowErrorSchema,
} from '../../openapi'

const logger = createLogger('workflows')

/** Codes that mean "someone else got there first" — try the next candidate. */
const RACE_LOST_CODES = new Set(['TASK_NOT_FOUND', 'TASK_ALREADY_ASSIGNED', 'TASK_NOT_ROLE_ASSIGNED'])

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.tasks.claim'],
}

function isRaceLost(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && RACE_LOST_CODES.has(code)
}

export async function POST(request: NextRequest) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const auth = await getAuthFromRequest(request)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const tenantId = auth.tenantId
    const organizationId = organizationScope?.selectedId ?? auth.orgId

    if (!tenantId || !organizationId) {
      return NextResponse.json(
        { error: 'Missing tenant or organization context' },
        { status: 400 },
      )
    }

    const roles = auth.roles ?? []
    const query = parseWorkInboxQuery(new URL(request.url).searchParams, new Date())
    const workInboxService = container.resolve<WorkInboxService>('workInboxService')

    // The candidate list is a READ, so it is subject to the same §6.4 rule as
    // every other read. Claiming is gated again by `taskHandler`, which owns
    // queue membership and the compare-and-set.
    const organizationIds = [organizationId]
    const visibility = await resolveTaskVisibilityForRequest({
      container,
      em,
      auth: { userId: auth.sub, tenantId, roleNames: roles },
      organizationIds,
      aclOrganizationId: organizationId,
      entityTypes: await collectScopedTaskEntityTypes(em, { tenantId, organizationIds }),
    })

    const candidates = await workInboxService.listClaimableWorkInbox(
      {
        ...query,
        kinds: [USER_TASK_INBOX_KIND],
        roles,
        statuses: ['PENDING'],
        myWork: false,
      },
      {
        scope: { tenantId, organizationIds, userId: auth.sub, roles, visibility },
        resolve: <T,>(name: string): T => container.resolve<T>(name),
      },
    )

    const taskHandler = container.resolve<TaskHandlerService>('taskHandler')

    for (const candidate of candidates) {
      try {
        await taskHandler.claimUserTask(
          em,
          candidate.id,
          auth.sub,
          { tenantId, organizationId },
          roles,
        )
      } catch (error) {
        if (isRaceLost(error)) continue
        throw error
      }

      const task = await em.findOne(UserTask, { id: candidate.id, tenantId, organizationId })
      const claimed = task ? toUserTaskWorkInboxRow(task, query.now) : candidate

      return NextResponse.json({
        data: serializeWorkInboxRow(claimed),
        message: 'Task claimed successfully',
      })
    }

    return NextResponse.json({ data: null, message: 'No claimable work available' })
  } catch (error) {
    logger.error('Error claiming the next work item', { err: error })
    return NextResponse.json(
      {
        error: 'Failed to claim the next work item',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Claim the next work item',
  methods: {
    POST: {
      summary: 'Claim the top claimable item from the work inbox',
      description:
        'Walks the caller\'s claimable queue in inbox order and claims the first item it wins. The claim is a conditional update, so concurrent callers never receive the same item — a caller that loses the race moves on to the next candidate. Returns null data when nothing is claimable.',
      responses: [
        { status: 200, description: 'The claimed item, or null when nothing was claimable', schema: workInboxClaimNextResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Missing tenant or organization context', schema: workflowErrorSchema },
        { status: 401, description: 'Unauthorized', schema: workflowErrorSchema },
        { status: 500, description: 'Internal server error', schema: workflowErrorSchema },
      ],
    },
  },
}
