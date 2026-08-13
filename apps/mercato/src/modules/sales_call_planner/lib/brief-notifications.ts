/**
 * Turning a deal-briefing lifecycle event into an in-app notification.
 *
 * One place, two subscribers: `brief.completed` and `brief.failed` differ only
 * in which notification type they name and which variables the body needs, so
 * recipient resolution, payload sanitisation and the best-effort contract live
 * here. This is the shape `packages/core/src/modules/workflows/lib/task-
 * notifications.ts` established — the only other place a workflow lifecycle
 * event becomes a notification.
 *
 * ## The recipient is the human who started the run
 *
 * A briefing is an explicitly requested, per-record action taken from a company
 * page, so its outcome belongs to the person who asked for it — the same person
 * who can retry it. `WorkflowInstance.metadata.initiatedBy` is the canonical
 * record of who that was: the start route overwrites it server-side from the
 * session and never trusts the client, which is also what the external-agent
 * ACL check reads.
 *
 * There is no widening fallback, deliberately. `createForRole` would need a
 * role this module does not configure and would announce who is being phoned to
 * every member of it, undoing the default-off grant that gates the call itself
 * — the same argument that keeps these events off the DOM event bridge. Should
 * a tenant later want team-wide visibility, `createForFeature` is the sanctioned
 * route: it is the only variant that resolves recipients from an ACL feature,
 * so `sales_call_planner.brief.run` would address exactly the operators already
 * allowed to start a briefing.
 *
 * A run with no traceable human (an `initiatedBy` of `trigger:<id>`, or none at
 * all) therefore notifies NOBODY and says so in the log. That is the same rule
 * `deliverTaskNotification` applies to a task assigned to nobody.
 *
 * ## Best-effort by contract
 *
 * `executeEmitEvent` emits WITHOUT `persistent`, so the bus delivers every
 * matching subscriber inline, in the transition activity's own call, and never
 * enqueues. `deliver()` already wraps each handler in try/catch and only
 * rethrows when the emitter asks for it (this one does not), so a throw here
 * cannot fail the workflow run — but it also gets no retry. Swallowing is
 * therefore the honest contract: a lost notification must never be worth
 * delaying or breaking the run that produced it.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { notificationTypes } from '../notifications'
import { BRIEF_FAILURE_CAUSES, type BriefFailureCause } from '../events'

const logger = createLogger('sales_call_planner')

/**
 * Matches the `entityType` the widget writes into `instance.metadata` and the
 * `resourceKind` the company detail page publishes to its injection spots, so
 * one notification, one workflow instance and one page all name the record the
 * same way.
 */
export const BRIEF_NOTIFICATION_SOURCE_ENTITY_TYPE = 'customers.company'

/** Company names are display data; a notification body is not a place for a blob. */
const MAX_COMPANY_NAME_LENGTH = 120

/** An extracted task list is bounded upstream; this is a second, local floor/ceiling. */
const MAX_TASK_COUNT = 1000

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type BriefNotificationResolverContext = {
  resolve: <T = unknown>(name: string) => T
  tenantId?: string | null
  organizationId?: string | null
}

/**
 * The facts a subscriber recovers from an event payload. Everything here is
 * either an id, a bounded display string or a member of a closed vocabulary —
 * nothing that reaches this type can carry a transcript or a phone number.
 */
export type BriefEventFacts = {
  companyId: string
  companyName: string
  workflowInstanceId: string | null
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Rebuild the facts key by key from the allowlist rather than spreading the
 * payload. An EMIT_EVENT payload is authored JSON — and AI-draftable — so
 * whatever else it carries stops here.
 */
export function readBriefEventFacts(payload: unknown): BriefEventFacts | null {
  const record = asRecord(payload)
  const engineScope = asRecord(record._workflow)

  const companyId = record.companyId
  if (!isUuid(companyId)) return null

  const rawName = readString(record, 'companyName')
  const companyName = rawName ? rawName.slice(0, MAX_COMPANY_NAME_LENGTH) : companyId

  const declaredInstanceId = record.workflowInstanceId
  const engineInstanceId = engineScope.workflowInstanceId
  const workflowInstanceId = isUuid(declaredInstanceId)
    ? declaredInstanceId
    : isUuid(engineInstanceId)
      ? engineInstanceId
      : null

  return { companyId, companyName, workflowInstanceId }
}

/** Anything outside the closed vocabulary becomes `unknown`, never free text. */
export function classifyFailureCause(value: unknown): BriefFailureCause {
  return typeof value === 'string' && (BRIEF_FAILURE_CAUSES as readonly string[]).includes(value)
    ? (value as BriefFailureCause)
    : 'unknown'
}

export function normalizeTaskCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(Math.max(Math.trunc(parsed), 0), MAX_TASK_COUNT)
}

export function buildCompanyDeepLink(companyId: string): string {
  return `/backend/customers/companies-v2/${companyId}`
}

/**
 * One row per run, so a retried emit refreshes the notification in place while
 * a genuinely new briefing of the same company arrives as its own row. The
 * company id is the fallback when the instance id is unknowable.
 */
export function buildBriefNotificationGroupKey(facts: BriefEventFacts): string {
  return `sales_call_planner:brief:${facts.workflowInstanceId ?? facts.companyId}`
}

function resolveScope(
  ctx: BriefNotificationResolverContext,
  payload: unknown
): { tenantId: string; organizationId: string | null } | null {
  const engineScope = asRecord(asRecord(payload)._workflow)
  const tenantId =
    typeof ctx.tenantId === 'string' && ctx.tenantId.length > 0
      ? ctx.tenantId
      : typeof engineScope.tenantId === 'string' && engineScope.tenantId.length > 0
        ? engineScope.tenantId
        : null
  if (!tenantId) return null

  const organizationId =
    typeof ctx.organizationId === 'string' && ctx.organizationId.length > 0
      ? ctx.organizationId
      : typeof engineScope.organizationId === 'string' && engineScope.organizationId.length > 0
        ? engineScope.organizationId
        : null

  return { tenantId, organizationId }
}

type BriefInstanceSnapshot = {
  initiatorUserId: string | null
  isDryRun: boolean
}

/**
 * `{{workflow.*}}` interpolation exposes no `initiatedBy`, so the initiator
 * cannot ride the payload and is read from the instance instead — scoped to the
 * trusted tenant, so an id from another tenant resolves to nothing.
 */
async function loadInstanceSnapshot(
  ctx: BriefNotificationResolverContext,
  tenantId: string,
  workflowInstanceId: string
): Promise<BriefInstanceSnapshot> {
  const rootEm = ctx.resolve<EntityManager>('em')
  const em = rootEm.fork()
  const { findOneWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
  const { WorkflowInstance } = await import('@open-mercato/core/modules/workflows/data/entities')

  const instance = await findOneWithDecryption(
    em,
    WorkflowInstance,
    { id: workflowInstanceId, tenantId },
    {},
    { tenantId }
  )

  const initiatedBy = instance?.metadata?.initiatedBy
  return {
    initiatorUserId: isUuid(initiatedBy) ? initiatedBy : null,
    isDryRun: instance?.isDryRun === true,
  }
}

function withCompanyAction(
  typeDef: NotificationTypeDefinition,
  companyLink: string
): NotificationTypeDefinition {
  return {
    ...typeDef,
    actions: [
      {
        id: 'open-company',
        labelKey: 'sales_call_planner.notifications.linkLabel',
        variant: 'outline',
        href: companyLink,
        icon: 'external-link',
      },
    ],
    primaryActionId: 'open-company',
  }
}

export type DeliverBriefNotificationOptions = {
  ctx: BriefNotificationResolverContext
  payload: unknown
  notificationType: string
  /** Body variables beyond `company`, which every body shares. */
  extraBodyVariables?: Record<string, string>
  component: string
}

/**
 * Create the notification for one briefing lifecycle event. Never throws: the
 * emitting workflow run must not depend on a notification landing.
 */
export async function deliverBriefNotification(
  options: DeliverBriefNotificationOptions
): Promise<void> {
  const { ctx, payload, notificationType, component } = options

  try {
    const facts = readBriefEventFacts(payload)
    if (!facts) {
      logger.warn('Briefing event carried no usable company id; nothing was notified', {
        component,
      })
      return
    }

    const scope = resolveScope(ctx, payload)
    if (!scope) {
      logger.warn('Briefing event carried no tenant scope; nothing was notified', { component })
      return
    }

    const typeDef = notificationTypes.find((type) => type.type === notificationType)
    if (!typeDef) return

    if (!facts.workflowInstanceId) {
      logger.warn('Briefing event names no workflow instance; the initiator is unknown', {
        component,
        companyId: facts.companyId,
      })
      return
    }

    const instance = await loadInstanceSnapshot(ctx, scope.tenantId, facts.workflowInstanceId)
    if (instance.isDryRun) return
    if (!instance.initiatorUserId) {
      logger.warn('Briefing run has no traceable initiator; nothing was notified', {
        component,
        workflowInstanceId: facts.workflowInstanceId,
      })
      return
    }

    const companyLink = buildCompanyDeepLink(facts.companyId)
    const notificationService = resolveNotificationService(ctx)

    await notificationService.create(
      buildNotificationFromType(withCompanyAction(typeDef, companyLink), {
        recipientUserId: instance.initiatorUserId,
        bodyVariables: { company: facts.companyName, ...(options.extraBodyVariables ?? {}) },
        sourceEntityType: BRIEF_NOTIFICATION_SOURCE_ENTITY_TYPE,
        sourceEntityId: facts.companyId,
        linkHref: companyLink,
        groupKey: buildBriefNotificationGroupKey(facts),
      }),
      scope
    )
  } catch (err) {
    logger.error('Failed to create briefing notification', { component, err })
  }
}
