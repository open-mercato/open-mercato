/**
 * Payload contracts for the `staff.timesheets.*` event family.
 *
 * **Why this file exists.** Outbound webhooks in this platform are not registered
 * per event: `packages/webhooks` subscribes once with `event: '*'`
 * (`subscribers/outbound-dispatch.ts`) and matches each emitted id against the
 * patterns a webhook endpoint subscribed to, so declaring an event in `events.ts`
 * IS its registration — it appears in `GET /api/webhooks/events` and is deliverable
 * from that moment (`packages/webhooks/AGENTS.md` → "When You Need Outbound
 * Webhooks", step 1). Two properties decide whether a declared event actually
 * reaches an endpoint, and neither is checked anywhere else:
 *
 *  1. the dispatcher drops any payload without a `tenantId` — it cannot resolve a
 *     webhook without one, so an event emitted without tenant scope is silently
 *     undeliverable;
 *  2. the delivered body IS the event payload, verbatim, so the payload is the
 *     integration contract an external billing or PM system codes against.
 *
 * The webhooks package has no payload-schema registry to register with, so these
 * schemas are that contract, published here and pinned by
 * `__tests__/timeTrackingEventPayloads.test.ts`: every declared `staff.timesheets.*`
 * id must appear below, and every schema must require `tenantId`.
 *
 * Each schema is `passthrough()`: the listed keys are what a subscriber may rely on,
 * additional keys are allowed so a later emitter can add one without breaking a
 * consumer that validates against this schema.
 *
 * Money note: `time_report.closed` carries minute totals but no amount, and
 * `time_project.budget_threshold_reached` carries an `amount` budget's value only
 * when the budget is measured in hours. Both events are `clientBroadcast: true` and
 * the DOM Event Bridge has no feature gate, so the amounts are withheld from the
 * payload itself rather than from one of its two audiences.
 *
 * Money is not the only thing that audience decides. A `clientBroadcast: true`
 * payload must also carry no operator free text and no customer identity: SSE
 * reaches every signed-in user of the organization, so `time_report.unlocked` omits
 * its mandatory `reason` and `time_report.closed` omits `customerId`.
 * `__tests__/timeTrackingEventPayloads.test.ts` fails if either reappears.
 */

import { z } from 'zod'

const scope = z.object({
  tenantId: z.string(),
  organizationId: z.string().nullable().optional(),
})

/** The `{ id, tenantId, organizationId }` shape every CRUD lifecycle event carries. */
const crudPayload = scope.extend({ id: z.string() }).passthrough()

const timerStarted = scope
  .extend({
    id: z.string(),
    staffMemberId: z.string().nullable(),
    startedAt: z.string(),
  })
  .passthrough()

const timerStopped = scope
  .extend({
    id: z.string(),
    staffMemberId: z.string().nullable(),
    stoppedAt: z.string(),
    durationMinutes: z.number(),
  })
  .passthrough()

const entryBulkUpdated = scope
  .extend({
    staffMemberId: z.string(),
    created: z.number(),
    updated: z.number(),
    deleted: z.number(),
    entryIds: z.array(z.string()),
  })
  .passthrough()

/** `sourceId` is the entry the copy was made from; `date` only on the copy-day path. */
const entryCopied = scope
  .extend({
    id: z.string(),
    sourceId: z.string(),
    staffMemberId: z.string().optional(),
    date: z.string().optional(),
  })
  .passthrough()

/** Batch-level: a report freeze/unfreeze names the report, never one entry. */
const entryLockToggled = scope
  .extend({
    reportId: z.string(),
  })
  .passthrough()

const segmentPayload = scope
  .extend({
    id: z.string(),
    timeEntryId: z.string(),
  })
  .passthrough()

const taskStatusChanged = scope
  .extend({
    id: z.string(),
    taskId: z.string().optional(),
    timeProjectId: z.string().optional(),
    previousTaskStatusId: z.string().nullable().optional(),
    taskStatusId: z.string().optional(),
  })
  .passthrough()

/**
 * No `customerId`: the event is `clientBroadcast: true` and the DOM Event Bridge
 * applies no feature check, so the one field linking a report to a named client is
 * withheld from the payload rather than from one of its two audiences — the same
 * trade the amount already makes. The emitter documents the field-by-field call.
 */
const reportClosed = scope
  .extend({
    id: z.string(),
    reportId: z.string(),
    reference: z.string(),
    lockedEntryCount: z.number(),
    totalBillableMinutes: z.number(),
    totalNonbillableMinutes: z.number(),
  })
  .passthrough()

/**
 * No `reason`: unlocking demands a written justification of up to 2000 characters,
 * and this event reaches every browser in the organization with no feature check.
 * The prose lives on the `StaffTimeReportEvent` audit row, behind the ACL.
 */
const reportUnlocked = scope
  .extend({
    id: z.string(),
    reference: z.string(),
    actorUserId: z.string().nullable(),
    unlockedEntryCount: z.number(),
  })
  .passthrough()

const reportExported = scope
  .extend({
    id: z.string(),
    reference: z.string(),
    format: z.string(),
    grouping: z.string(),
    rowCount: z.number(),
  })
  .passthrough()

const reportPortalPublished = scope
  .extend({
    id: z.string(),
    reference: z.string(),
    periodFrom: z.string(),
    periodTo: z.string(),
    /**
     * The portal SSE stream narrows a broadcast to these customer-user ids. The
     * emitter never publishes this event with an empty list, so a report can only
     * ever reach the portal users of its own customer.
     */
    recipientUserIds: z.array(z.string()).min(1),
  })
  .passthrough()

const projectCurrencyChanged = scope
  .extend({
    id: z.string(),
    currencyCode: z.string(),
    previousCurrencyCode: z.string().nullable(),
    converted: z.boolean(),
  })
  .passthrough()

const budgetThresholdReached = scope
  .extend({
    id: z.string(),
    timeProjectId: z.string(),
    thresholdPercent: z.number(),
    percent: z.number().nullable(),
    budgetKind: z.string(),
    /** Present only for an `hours` budget — an `amount` budget states money. */
    budgetValue: z.number().nullable().optional(),
    /** Present only for an `hours` budget — see `budgetValue`. */
    usedValue: z.number().nullable().optional(),
  })
  .passthrough()

const projectAccessRequested = scope
  .extend({
    requesterUserId: z.string(),
    requesterName: z.string(),
    timeProjectId: z.string().nullable(),
    timeProjectName: z.string().nullable(),
    requestedAt: z.string(),
  })
  .passthrough()

const projectAccessDecision = scope.extend({ id: z.string() }).passthrough()

const settingsUpdated = scope.extend({ settings: z.record(z.string(), z.unknown()) }).passthrough()

const roundingReapplied = scope
  .extend({
    progressJobId: z.string(),
    candidateCount: z.number(),
  })
  .passthrough()

/**
 * Every declared `staff.timesheets.*` event id and the payload a webhook endpoint
 * subscribed to it receives.
 */
export const staffTimeTrackingEventPayloadSchemas = {
  'staff.timesheets.time_entry.created': crudPayload,
  'staff.timesheets.time_entry.updated': crudPayload,
  'staff.timesheets.time_entry.deleted': crudPayload,
  'staff.timesheets.time_entry.timer_started': timerStarted,
  'staff.timesheets.time_entry.timer_stopped': timerStopped,
  'staff.timesheets.time_entry.bulk_updated': entryBulkUpdated,
  'staff.timesheets.time_entry.copied': entryCopied,
  'staff.timesheets.time_entry.locked': entryLockToggled,
  'staff.timesheets.time_entry.unlocked': entryLockToggled,
  'staff.timesheets.time_entry_segment.created': segmentPayload,
  'staff.timesheets.time_entry_segment.updated': segmentPayload,
  'staff.timesheets.time_entry_segment.deleted': segmentPayload,
  'staff.timesheets.time_project.created': crudPayload,
  'staff.timesheets.time_project.updated': crudPayload,
  'staff.timesheets.time_project.deleted': crudPayload,
  'staff.timesheets.time_project.currency_changed': projectCurrencyChanged,
  'staff.timesheets.time_project.budget_threshold_reached': budgetThresholdReached,
  'staff.timesheets.time_project_member.created': crudPayload,
  'staff.timesheets.time_project_member.updated': crudPayload,
  'staff.timesheets.time_project_member.deleted': crudPayload,
  'staff.timesheets.time_project_access.granted': projectAccessDecision,
  'staff.timesheets.time_project_access.denied': projectAccessDecision,
  'staff.timesheets.project_access.requested': projectAccessRequested,
  'staff.timesheets.time_task.created': crudPayload,
  'staff.timesheets.time_task.updated': crudPayload,
  'staff.timesheets.time_task.deleted': crudPayload,
  'staff.timesheets.time_task.status_changed': taskStatusChanged,
  'staff.timesheets.time_task_status.created': crudPayload,
  'staff.timesheets.time_task_status.updated': crudPayload,
  'staff.timesheets.time_task_status.deleted': crudPayload,
  'staff.timesheets.time_tag.created': crudPayload,
  'staff.timesheets.time_tag.updated': crudPayload,
  'staff.timesheets.time_tag.deleted': crudPayload,
  'staff.timesheets.time_task_comment.created': crudPayload,
  'staff.timesheets.time_task_comment.updated': crudPayload,
  'staff.timesheets.time_task_comment.deleted': crudPayload,
  'staff.timesheets.time_report.created': crudPayload,
  'staff.timesheets.time_report.updated': crudPayload,
  'staff.timesheets.time_report.deleted': crudPayload,
  'staff.timesheets.time_report.closed': reportClosed,
  'staff.timesheets.time_report.unlocked': reportUnlocked,
  'staff.timesheets.time_report.exported': reportExported,
  'staff.timesheets.time_report.portal_published': reportPortalPublished,
  'staff.timesheets.time_tracking.settings_updated': settingsUpdated,
  'staff.timesheets.time_tracking.rounding_reapplied': roundingReapplied,
} as const

export type StaffTimeTrackingEventId = keyof typeof staffTimeTrackingEventPayloadSchemas

export type StaffTimeTrackingEventPayload<TEventId extends StaffTimeTrackingEventId> = z.infer<
  typeof staffTimeTrackingEventPayloadSchemas[TEventId]
>
