import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('agent_orchestrator').child({ component: 'process-workflow-grant' })

/**
 * Authorises the execution grant a process definition puts on its workflow.
 *
 * A process's `grantedFeatures` becomes the bound workflow's, and core mints a
 * least-privilege principal from it — so setting one is a PRIVILEGE decision, not
 * an ordinary edit. Core's own definitions API gates it twice: on
 * `workflows.definitions.grant_features`, and on the requested set being a subset
 * of the saving user's own features. Routing a grant through this module without
 * the same gates would let anyone holding `processes.manage` mint a principal
 * carrying features they do not themselves have.
 *
 * The decision is delegated to core's `authorizeWorkflowGrantChange` rather than
 * reimplemented, so the two surfaces cannot drift on what counts as a grant, how
 * wildcards resolve, or which error body a refusal produces.
 *
 * FAIL-CLOSED on an unreachable peer or an unresolvable RBAC service: a
 * permission check that cannot run is not a passed one. The one exception is a
 * NO-OP change — a definition re-saving the grant it already has asks for no new
 * privilege, so it needs no gate and cannot be blocked by an absent peer.
 */
export type ProcessWorkflowGrantFailure = {
  status: number
  body: { error: string; code?: string; details?: { missingFeatures: string[] } }
}

type RbacServiceLike = {
  userHasAllFeatures: (
    userId: string,
    features: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

function sameGrant(a: string[], b: string[]): boolean {
  const left = [...new Set(a)].sort((x, y) => x.localeCompare(y))
  const right = [...new Set(b)].sort((x, y) => x.localeCompare(y))
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export async function authorizeProcessWorkflowGrant(
  ctx: CrudCtx,
  params: { requested: string[]; current: string[] },
): Promise<ProcessWorkflowGrantFailure | null> {
  // Asking for exactly what is already granted is not a privilege change, so an
  // ordinary metadata save of a granted definition never demands the gate.
  if (sameGrant(params.requested, params.current)) return null

  const userId = ctx.auth?.sub ?? null
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!userId) {
    return { status: 403, body: { error: 'An execution grant requires an authenticated author.' } }
  }

  let rbacService: RbacServiceLike
  let authorize: typeof import('@open-mercato/core/modules/workflows/lib/definition-grant').authorizeWorkflowGrantChange
  try {
    rbacService = ctx.container.resolve('rbacService') as RbacServiceLike
    ;({ authorizeWorkflowGrantChange: authorize } = (await import(
      '@open-mercato/core/modules/workflows/lib/definition-grant'
    )) as typeof import('@open-mercato/core/modules/workflows/lib/definition-grant'))
  } catch (error) {
    logger.warn('workflow grant authorisation unavailable; refusing the grant', {
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      status: 503,
      body: { error: 'Execution grants cannot be authorised right now — the workflows module is unavailable.' },
    }
  }

  const failure = await authorize(rbacService, {
    userId,
    scope: { tenantId, organizationId },
    requested: params.requested,
    current: params.current,
  })
  return failure ? { status: failure.status, body: failure.body } : null
}
