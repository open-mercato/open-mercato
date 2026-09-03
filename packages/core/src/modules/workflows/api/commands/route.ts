/**
 * Workflow-Safe Commands API
 *
 * Endpoint:
 * - GET /api/workflows/commands - List commands allowlisted for UPDATE_ENTITY activities
 *
 * ## Why this returns disabled candidates instead of hiding them
 *
 * It used to return the whole catalogue to any holder of
 * `workflows.definitions.edit`, which meant an author could pick a command the
 * tenant had not enabled and only discover it when a run failed. Returning ONLY
 * the enabled ones would fix that failure but create a worse one: the field
 * accepts free text (`allowCustomValues`), so a command that vanishes from the
 * list is not prevented, it is merely unexplained — "why can I not update
 * products here?" becomes unanswerable from the editor.
 *
 * So every candidate is returned with an explicit `enabled` flag and the picker
 * renders the disabled ones as unavailable, naming the remedy. This is the same
 * rule the command palette already follows: a command that cannot run right now
 * is shown disabled, never hidden, because a missing entry reads as
 * "unsupported" and a disabled one reads as "not now".
 *
 * `enabled`, `defaultEnabled` and `labelKey` are ADDITIVE fields on an existing
 * response; `commandId` and `requiredFeatures` are unchanged.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { listWorkflowSafeCommands } from '../../lib/workflow-safe-commands'
import { resolveWorkflowCommandCatalogue } from '../../lib/workflow-command-enablement'
import { resolveWorkflowCommandPolicyForContainer } from '../../lib/workflow-command-settings'
import { workflowsTag, workflowErrorSchema, workflowSafeCommandListResponseSchema } from '../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.definitions.edit'],
}

/**
 * GET /api/workflows/commands
 *
 * List the workflow-safe command allowlist for the UPDATE_ENTITY command picker.
 */
export async function GET(request: NextRequest) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(request)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const tenantId = auth.tenantId
    const organizationId = scope?.selectedId ?? auth.orgId

    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenant context' }, { status: 400 })
    }

    const rbacService = container.resolve('rbacService')
    const hasPermission = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.definitions.edit'],
      { tenantId, organizationId }
    )

    if (!hasPermission) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const policy = await resolveWorkflowCommandPolicyForContainer(container, tenantId)
    const items = resolveWorkflowCommandCatalogue(listWorkflowSafeCommands(), policy)

    return NextResponse.json({ items })
  } catch (error) {
    logger.error('Error listing workflow-safe commands', { err: error })
    return NextResponse.json(
      { error: 'Failed to list workflow-safe commands' },
      { status: 500 }
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'List workflow-safe commands',
  methods: {
    GET: {
      summary: 'List commands allowlisted for UPDATE_ENTITY activities',
      description: 'Returns the registered workflow-safe command catalogue consumed by the UPDATE_ENTITY command picker, each entry carrying whether the caller\'s tenant has enabled it. Entries with enabled:false, and commands outside the catalogue entirely, can still be authored but fail at runtime.',
      responses: [
        { status: 200, description: 'Allowlisted workflow-safe commands', schema: workflowSafeCommandListResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Missing tenant context', schema: workflowErrorSchema },
        { status: 401, description: 'Unauthorized', schema: workflowErrorSchema },
        { status: 403, description: 'Insufficient permissions', schema: workflowErrorSchema },
        { status: 500, description: 'Internal server error', schema: workflowErrorSchema },
      ],
    },
  },
}
