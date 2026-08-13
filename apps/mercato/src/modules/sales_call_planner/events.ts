import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Sales Call Planner module events.
 *
 * Two facts, emitted by the deal-briefing workflow's transition activities
 * (tracker B5) through `EMIT_EVENT`: the briefing call settled and produced N
 * follow-up tasks, or it did not settle and here is WHY, as a classification.
 * A subscriber in this module turns each into an in-app notification, which is
 * the only additive route to a notification today — no activity type creates
 * one and `notificationService` is a DI call.
 *
 * ## NOT `clientBroadcast`, and that is a security decision
 *
 * The DOM Event Bridge forwards a broadcast frame to EVERY backoffice
 * connection in the tenant + organization WITHOUT evaluating ACL features —
 * the documented reason the workflows task events stay off it, and the reason
 * every `agent_orchestrator.external_run.*` event is `clientBroadcast: false`
 * (external-agents tracker T2.8). This feature places an outbound phone call
 * behind a deliberately default-off grant; a live org-wide feed of which
 * companies are being phoned, and how many follow-ups each call produced,
 * would hand that information to operators holding neither
 * `sales_call_planner.brief.run` nor
 * `agent_orchestrator.external_agents.invoke`.
 *
 * It would also be INERT here even if switched on: the bridge only publishes
 * when the payload carries a top-level `tenantId`, and `executeEmitEvent`
 * nests the scope under `_workflow` instead. A flag that reads as "on" while
 * doing nothing is worse than an honest "off".
 *
 * The realtime need is already met by the correct channel: creating the
 * notification emits `notifications.notification.created` addressed to a single
 * `recipientUserId`, so the initiator's bell updates live and nobody else's
 * does.
 *
 * ## Payload discipline (non-negotiable)
 *
 * Ids, counts and CLASSIFICATIONS only. Never the call transcript, never the
 * phone number, never a raw error string, never anything the voice agent
 * heard. These payloads reach a notification row and, through it, a browser.
 * The allowlists below are the contract; `lib/brief-notifications.ts` rebuilds
 * every payload key by key from them and coerces `cause` into the closed
 * vocabulary, so an authored — and AI-draftable — workflow definition cannot
 * widen what travels by interpolating something else into the EMIT_EVENT
 * config.
 */

export const BRIEF_COMPLETED_EVENT_ID = 'sales_call_planner.brief.completed'
export const BRIEF_FAILED_EVENT_ID = 'sales_call_planner.brief.failed'

/**
 * Every key a `sales_call_planner.brief.completed` payload may carry.
 * `workflowInstanceId` is optional because the engine always adds the same id
 * under `_workflow.workflowInstanceId`; declaring it lets a definition author
 * pass `{{workflow.instanceId}}` explicitly.
 */
export const BRIEF_COMPLETED_PAYLOAD_KEYS = [
  'companyId',
  'companyName',
  'workflowInstanceId',
  'taskCount',
] as const

/** Every key a `sales_call_planner.brief.failed` payload may carry. */
export const BRIEF_FAILED_PAYLOAD_KEYS = [
  'companyId',
  'companyName',
  'workflowInstanceId',
  'cause',
] as const

/**
 * The closed cause vocabulary. Four of the five entries name a state the
 * platform already routes on — the workflow's agent steps expose the fixed
 * outcome handles `error` and `guardrailBlocked`, and an external run settles
 * as answered, failed or swept — so a definition author can wire a cause
 * without inventing one. `unknown` is the coercion target for anything else,
 * which is what keeps a free-text error out of a notification row.
 */
export const BRIEF_FAILURE_CAUSES = [
  'agentError',
  'guardrailBlocked',
  'callNotReached',
  'callTimeout',
  'taskCreationFailed',
  'unknown',
] as const

export type BriefFailureCause = (typeof BRIEF_FAILURE_CAUSES)[number]

const events = [
  {
    id: BRIEF_COMPLETED_EVENT_ID,
    label: 'Deal Briefing Call Completed',
    description:
      'The briefing call settled and the extracted actions were turned into follow-up tasks.',
    entity: 'brief',
    category: 'lifecycle',
    payloadSchema: {
      fields: [
        { path: 'companyId', type: 'text', label: 'Company id' },
        { path: 'companyName', type: 'text', label: 'Company name', optional: true },
        { path: 'workflowInstanceId', type: 'text', label: 'Workflow instance id', optional: true },
        { path: 'taskCount', type: 'number', label: 'Follow-up tasks created' },
        { path: '_workflow', type: 'object', label: 'Engine-added workflow scope', optional: true },
      ],
    },
  },
  {
    id: BRIEF_FAILED_EVENT_ID,
    label: 'Deal Briefing Call Failed',
    description:
      'The briefing call did not settle. Carries a classified cause, never a raw error.',
    entity: 'brief',
    category: 'lifecycle',
    payloadSchema: {
      fields: [
        { path: 'companyId', type: 'text', label: 'Company id' },
        { path: 'companyName', type: 'text', label: 'Company name', optional: true },
        { path: 'workflowInstanceId', type: 'text', label: 'Workflow instance id', optional: true },
        { path: 'cause', type: 'select', label: 'Classified failure cause' },
        { path: '_workflow', type: 'object', label: 'Engine-added workflow scope', optional: true },
      ],
    },
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'sales_call_planner',
  events,
})

/** Type-safe event emitter for the sales_call_planner module. */
export const emitSalesCallPlannerEvent = eventsConfig.emit

/** Event IDs that can be emitted by the sales_call_planner module. */
export type SalesCallPlannerEventId = (typeof events)[number]['id']

export default eventsConfig
