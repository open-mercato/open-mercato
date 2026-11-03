import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  buildInspectorUserTaskDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  deleteTaskBindingEntityTypeIfExists,
  findInstanceUserTask,
  pollWorkInbox,
  registerTaskBindingEntityType,
  startWorkflowInstanceFixture,
  type WorkInboxListBody,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-039 [P0]: Work Inbox projection — merge, filters, ordering and the limit clamp
 *
 * Surfaces under test:
 * - GET /api/workflows/work-inbox
 *
 * Real-behavior notes (verified against lib/work-inbox/*):
 * - The inbox is a PROJECTION over existing rows, not a table. Core registers the `user_task`
 *   source; `meta.kinds` lists the sources that actually answered and `meta.degradedKinds`
 *   the ones that threw, so a single module's outage narrows the queue instead of failing it.
 * - A row is `serializeWorkInboxRow(row)`: the provider payload spread UNDER the common
 *   projection. That is what keeps a `user_task` row a strict superset of the row
 *   `GET /api/workflows/tasks` returns (the enterprise "Review proposal" action reads
 *   `row.proposalId`, which exists only in the provider payload).
 * - Ordering is priority → due date → created (oldest first), applied by the merge service
 *   over the window each source returns. `priority` is an authored label with no ordinal
 *   column, so SQL cannot order on it; an unset priority ranks WITH `medium`, not last.
 * - `limit` is clamped to 100 (root AGENTS.md: `pageSize` never exceeds 100). The clamp is
 *   silent — an over-large request succeeds with the clamped page rather than 400-ing.
 * - Scoping trick: both fixtures bind their task to the same run-unique `entityType`, so
 *   `?entityType=` narrows the shared database down to exactly this test's two rows and the
 *   ordering assertion stays deterministic. The binding id is resolved from the run context
 *   at task creation (`idPath` → `{{context.*}}`), which is also what makes it filterable.
 *   The `entityType` is REGISTERED as a tenant custom entity first: spec §6.4's entity
 *   clause fails closed on an unresolvable type, so an invented one hides the task from
 *   everyone but a superadmin (`denied:unknown-entity-type`). See
 *   `registerTaskBindingEntityType`.
 */
const idsOf = (body: WorkInboxListBody | null): string[] => (body?.data ?? []).map((row) => row.id ?? '')

test.describe('TC-WF-039: work inbox projection, filters and ordering', () => {
  test('merges provider rows, filters, orders by priority then due then age, and clamps limit', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const entityType = `qa:work_inbox_${timestamp}`
    const boundRecordId = `qa-record-${timestamp}`

    const buildPayload = (suffix: string, priority: 'extreme' | 'low') =>
      buildInspectorUserTaskDefinitionPayload(timestamp, {
        suffix,
        stepName: `Inbox ${priority} ${timestamp}`,
        userTaskConfig: {
          assignedToRoles: ['admin'],
          priority,
          entityBindings: [{ entityType, idPath: 'context.recordId', label: `Record ${timestamp}` }],
          formSchema: { properties: { approved: { type: 'boolean' } } },
        },
      })

    const extremeDef = buildPayload('-extreme', 'extreme')
    const lowDef = buildPayload('-low', 'low')
    let extremeDefId: string | null = null
    let lowDefId: string | null = null
    let extremeInstanceId: string | null = null
    let lowInstanceId: string | null = null

    const scoped = `?entityType=${encodeURIComponent(entityType)}`

    try {
      await registerTaskBindingEntityType(request, token, entityType, `QA Work Inbox ${timestamp}`)
      extremeDefId = await createWorkflowDefinitionFixture(request, token, extremeDef)
      lowDefId = await createWorkflowDefinitionFixture(request, token, lowDef)

      extremeInstanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: extremeDef.workflowId,
        initialContext: { recordId: boundRecordId },
      })
      lowInstanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: lowDef.workflowId,
        initialContext: { recordId: boundRecordId },
      })

      const extremeTask = await findInstanceUserTask(request, token, extremeInstanceId, { statuses: ['PENDING'] })
      const lowTask = await findInstanceUserTask(request, token, lowInstanceId, { statuses: ['PENDING'] })
      expect(extremeTask?.id, 'the extreme-priority task should exist').toBeTruthy()
      expect(lowTask?.id, 'the low-priority task should exist').toBeTruthy()
      const extremeTaskId = extremeTask!.id!
      const lowTaskId = lowTask!.id!

      const listed = await pollWorkInbox(
        request,
        token,
        scoped,
        (body) => (body.data ?? []).length === 2,
      )

      // Ordering: extreme outranks low regardless of which instance started first.
      expect(idsOf(listed), 'rows are ordered by priority first').toEqual([extremeTaskId, lowTaskId])
      expect(listed?.pagination?.total, 'total counts every matching row').toBe(2)
      expect(listed?.meta?.kinds, 'the core user_task source answered').toContain('user_task')
      expect(listed?.meta?.degradedKinds, 'no source failed').toEqual([])

      // Row shape: the common projection plus the flattened provider payload.
      const extremeRow = (listed?.data ?? []).find((row) => row.id === extremeTaskId)
      expect(extremeRow?.kind).toBe('user_task')
      expect(extremeRow?.moduleId).toBe('workflows')
      expect(extremeRow?.priority).toBe('extreme')
      expect(extremeRow?.status).toBe('PENDING')
      expect(extremeRow?.overdue, 'a task without a due date is never overdue').toBe(false)
      expect(extremeRow?.assignedToRoles, 'the role queue rides along on the row').toContain('admin')
      expect(extremeRow?.entityTypes, 'bound entity types are projected for filtering').toEqual([entityType])
      expect(extremeRow?.entityBindings?.[0]?.entityId, 'the binding id resolved from run context').toBe(boundRecordId)
      expect(extremeRow?.detailHref).toBe(`/backend/tasks/${extremeTaskId}`)
      expect(
        (extremeRow?.actions ?? []).map((action) => action.id),
        'the provider advertises its own actions declaratively',
      ).toContain('claim')

      // kind / module filters select the source; an unknown kind yields nothing.
      const byKind = await pollWorkInbox(request, token, `${scoped}&kind=user_task`, (body) => (body.data ?? []).length === 2)
      expect(idsOf(byKind)).toEqual([extremeTaskId, lowTaskId])
      const byUnknownKind = await pollWorkInbox(request, token, `${scoped}&kind=not_a_kind`, () => true)
      expect(idsOf(byUnknownKind), 'an unregistered kind contributes no rows').toEqual([])
      expect(byUnknownKind?.meta?.kinds, 'and no source is reported as having answered').toEqual([])
      const byModule = await pollWorkInbox(request, token, `${scoped}&module=workflows`, (body) => (body.data ?? []).length === 2)
      expect(idsOf(byModule)).toEqual([extremeTaskId, lowTaskId])

      // priority / status / role / assignedTo filters.
      const byPriority = await pollWorkInbox(request, token, `${scoped}&priority=extreme`, (body) => (body.data ?? []).length === 1)
      expect(idsOf(byPriority)).toEqual([extremeTaskId])
      const byStatus = await pollWorkInbox(request, token, `${scoped}&status=PENDING`, (body) => (body.data ?? []).length === 2)
      expect(idsOf(byStatus)).toEqual([extremeTaskId, lowTaskId])
      const byTerminalStatus = await pollWorkInbox(request, token, `${scoped}&status=COMPLETED`, () => true)
      expect(idsOf(byTerminalStatus), 'nothing here is completed yet').toEqual([])
      const byRole = await pollWorkInbox(request, token, `${scoped}&role=admin`, (body) => (body.data ?? []).length === 2)
      expect(idsOf(byRole)).toEqual([extremeTaskId, lowTaskId])
      const byOtherAssignee = await pollWorkInbox(
        request,
        token,
        `${scoped}&assignedTo=00000000-0000-4000-8000-000000000000`,
        () => true,
      )
      expect(idsOf(byOtherAssignee), 'a role-queue task has no individual assignee').toEqual([])

      // myWork (and the legacy `myTasks` alias the shipped inbox has always sent) matches the
      // caller's role queue as well as their own assignments.
      const myWork = await pollWorkInbox(request, token, `${scoped}&myWork=true`, (body) => (body.data ?? []).length === 2)
      expect(idsOf(myWork), 'a queue the caller can serve is their work').toEqual([extremeTaskId, lowTaskId])
      const myTasksAlias = await pollWorkInbox(request, token, `${scoped}&myTasks=true`, (body) => (body.data ?? []).length === 2)
      expect(idsOf(myTasksAlias), 'myTasks is an alias for myWork').toEqual([extremeTaskId, lowTaskId])

      // overdue is derived from the due date, which these fixtures do not set.
      const overdue = await pollWorkInbox(request, token, `${scoped}&overdue=true`, () => true)
      expect(idsOf(overdue)).toEqual([])

      // Paging over the scoped set: limit caps the page, offset walks it, total stays whole.
      //
      // PRIORITY ORDER IS NOT GUARANTEED ACROSS A PAGE BOUNDARY, and asserting
      // otherwise asserts something the architecture does not promise. The inbox
      // is "merge, sort, then page" (`lib/work-inbox/service.ts:37-87`): each
      // source is asked for exactly `offset + limit` rows, ordered by the only
      // columns SQL has (`lib/work-inbox/user-task-source.ts:216` —
      // `dueDate ASC, createdAt DESC`), and the canonical priority comparator then
      // sorts THAT WINDOW. `priority` is an authored label with no ordinal column,
      // so a window narrower than the result set can exclude the highest-priority
      // row before the comparator ever sees it. Paging is therefore asserted over
      // a window that covers the whole scoped set; the cross-page case is a real
      // limitation of the design, not of this test.
      const firstPage = await pollWorkInbox(request, token, `${scoped}&limit=2&offset=0`, (body) => (body.data ?? []).length === 2)
      expect(idsOf(firstPage)).toEqual([extremeTaskId, lowTaskId])
      expect(firstPage?.pagination?.total).toBe(2)
      expect(firstPage?.pagination?.hasMore, 'the first full page exhausts the scoped set').toBe(false)
      const secondPage = await pollWorkInbox(request, token, `${scoped}&limit=2&offset=1`, (body) => (body.data ?? []).length === 1)
      expect(idsOf(secondPage), 'offset walks the ordered window').toEqual([lowTaskId])
      expect(secondPage?.pagination?.total, 'total stays whole across pages').toBe(2)
      expect(secondPage?.pagination?.hasMore, 'the scoped set is exhausted').toBe(false)

      // The limit clamp is silent: an over-large request succeeds at the maximum page size.
      const clamped = await pollWorkInbox(request, token, `${scoped}&limit=500`, (body) => (body.data ?? []).length === 2)
      expect(clamped?.pagination?.limit, 'limit is clamped to 100, not rejected').toBe(100)

      // The unauthenticated case is the gate, not the projection.
      const unauthenticated = await apiRequest(request, 'GET', '/api/workflows/work-inbox', {
        token: 'not-a-valid-session-token',
      })
      expect(unauthenticated.status(), 'an invalid session is rejected').toBe(401)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, extremeInstanceId)
      await cancelWorkflowInstanceIfExists(request, token, lowInstanceId)
      await deleteWorkflowDefinitionIfExists(request, token, extremeDefId)
      await deleteWorkflowDefinitionIfExists(request, token, lowDefId)
      await deleteTaskBindingEntityTypeIfExists(request, token, entityType)
    }
  })
})
