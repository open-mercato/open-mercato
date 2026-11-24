import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import {
  buildFeatureNotificationFromType,
  buildNotificationFromType,
} from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { AgentRun } from '../data/entities'
import {
  AGENT_RUN_REVIEW_REQUESTED_NOTIFICATION,
  AGENT_RUN_SOURCE_ENTITY_TYPE,
  notificationTypes,
} from '../notifications'

const logger = createLogger('agent_orchestrator').child({ component: 'run-review-requested-notification' })

export const TRACE_VIEW_FEATURE = 'agent_orchestrator.trace.view'
export const UNATTENDED_REVIEWER_FEATURE = 'agent_orchestrator.guardrail.manage'

/**
 * Tell a human that a run outside the proposal flow asked for review (B-7).
 *
 * Proposal runs are skipped: their proposal is already held and announced by
 * `proposal-pending-notification`. Eval replays are skipped: a replay is a
 * record, not somebody's work.
 *
 * Recipient: the person who started the run interactively, when they may open
 * the traces it links to; otherwise (workflow, API key, agent token, or a
 * caller without `trace.view`) the narrow group holding `guardrail.manage`,
 * restricted to the run's organization.
 *
 * The payload is only a pointer. The run is re-read under the payload's tenant
 * AND organization, so a mismatched or forged id notifies nobody, and the body
 * carries the agent id alone, never run input, output or reason text.
 *
 * Grouped per agent: later runs of the same agent refresh the recipient's open
 * notification instead of stacking new ones.
 */
export const metadata = {
  event: 'agent_orchestrator.run.review_requested',
  persistent: true,
  id: 'agent_orchestrator:run-review-requested-notification',
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve<T = unknown>(name: string): T }
  tenantId?: string | null
  organizationId?: string | null
}

type RbacLike = {
  userHasAllFeatures: (
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function tryResolve<T>(ctx: ResolverContext, name: string): T | null {
  try {
    return (ctx.resolve(name) as T) ?? null
  } catch {
    return null
  }
}

export function buildRunReviewLinkHref(agentId: string): string {
  const params = new URLSearchParams({ agent: agentId, facet: 'needs-review' })
  return `/backend/traces?${params.toString()}`
}

async function canOpenTraces(
  rbac: RbacLike | null,
  userId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<boolean> {
  if (!rbac) return false
  try {
    return await rbac.userHasAllFeatures(userId, [TRACE_VIEW_FEATURE], scope)
  } catch (err) {
    logger.warn('invoker permission check failed; falling back to the reviewer group', {
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

export default async function handle(payload: unknown, ctx: ResolverContext): Promise<void> {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const runId = readString(record, 'agentRunId')
  const tenantId = ctx.tenantId ?? readString(record, 'tenantId')
  const organizationId = ctx.organizationId ?? readString(record, 'organizationId')
  if (!runId || !tenantId || !organizationId) return

  try {
    const em = (ctx.resolve('em') as EntityManager).fork()
    const run = await em.findOne(AgentRun, { id: runId, tenantId, organizationId })
    if (!run) return
    if (run.source !== 'runtime') return
    if (run.resultKind === 'proposal' || run.proposalId) return

    const typeDef = notificationTypes.find((type) => type.type === AGENT_RUN_REVIEW_REQUESTED_NOTIFICATION)
    if (!typeDef) return

    const scope = { tenantId, organizationId }
    const content = {
      bodyVariables: { agent: run.agentId },
      sourceEntityType: AGENT_RUN_SOURCE_ENTITY_TYPE,
      sourceEntityId: run.id,
      linkHref: buildRunReviewLinkHref(run.agentId),
      groupKey: `${AGENT_RUN_REVIEW_REQUESTED_NOTIFICATION}:${run.agentId}`,
    }
    const notificationService = resolveNotificationService(ctx.container ?? { resolve: ctx.resolve })

    const invokedByUserId = readString(record, 'invokedByUserId')
    if (invokedByUserId && (await canOpenTraces(tryResolve<RbacLike>(ctx, 'rbacService'), invokedByUserId, scope))) {
      await notificationService.create(
        buildNotificationFromType(typeDef, { ...content, recipientUserId: invokedByUserId }),
        scope,
      )
      return
    }

    await notificationService.createForFeature(
      {
        ...buildFeatureNotificationFromType(typeDef, { ...content, requiredFeature: UNATTENDED_REVIEWER_FEATURE }),
        restrictRecipientsToOrganization: true,
      },
      scope,
    )
  } catch (err) {
    logger.warn('create failed', { runId, error: err instanceof Error ? err.message : String(err) })
    getTelemetryRuntime()?.reportError(err, {
      module: 'agent_orchestrator',
      code: 'agent_orchestrator.run_review_notification_failed',
      attributes: { runId },
    })
  }
}
