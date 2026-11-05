import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';
import { expectId, readJsonSafe } from './generalFixtures';

export function buildMinimalDefinitionPayload(timestamp: number, suffix = '') {
  const id = `qa-wf${suffix}-${timestamp}`;
  return {
    workflowId: id,
    workflowName: `QA Workflow${suffix} ${timestamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        {
          transitionId: 'start-to-end',
          fromStepId: 'start',
          toStepId: 'end',
          trigger: 'auto',
        },
      ],
    },
    enabled: true,
  };
}

export function buildUserTaskDefinitionPayload(timestamp: number) {
  return {
    workflowId: `qa-wf-task-${timestamp}`,
    workflowName: `QA User Task Workflow ${timestamp}`,
    description: 'Workflow with a USER_TASK step for integration testing',
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'review',
          stepName: 'Review',
          stepType: 'USER_TASK',
          userTaskConfig: {
            assignedTo: 'admin',
            formSchema: {
              fields: [
                { name: 'approved', type: 'boolean', label: 'Approved', required: true },
                { name: 'comments', type: 'string', label: 'Comments' },
              ],
            },
          },
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        {
          transitionId: 'start-to-review',
          fromStepId: 'start',
          toStepId: 'review',
          trigger: 'auto',
        },
        {
          transitionId: 'review-to-end',
          fromStepId: 'review',
          toStepId: 'end',
          trigger: 'manual',
        },
      ],
    },
    enabled: true,
  };
}

/**
 * Definition exercising every isolation guarantee a dry run must give
 * (spec section 8.2): it emits an event, mutates an entity, sends an email and
 * raises a USER_TASK. In a real run each of those is a side effect; in a dry
 * run every one must be replaced by its would-do report entry.
 */
export function buildDryRunIsolationDefinitionPayload(timestamp: number, suffix = '') {
  return {
    workflowId: `qa-wf-dryrun-${timestamp}${suffix}`,
    workflowName: `QA Dry Run Isolation ${timestamp}${suffix}`,
    description: 'Workflow whose every step has a side effect, for dry-run isolation testing',
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'notify', stepName: 'Notify', stepType: 'AUTOMATED' },
        {
          stepId: 'review',
          stepName: 'Review',
          stepType: 'USER_TASK',
          userTaskConfig: {
            assignedTo: ['admin'],
            formSchema: { fields: [{ name: 'approved', type: 'boolean', label: 'Approved', required: true }] },
          },
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        {
          transitionId: 'start-to-notify',
          fromStepId: 'start',
          toStepId: 'notify',
          trigger: 'auto',
          activities: [
            {
              activityId: 'send-mail',
              activityName: 'sendMail',
              activityType: 'SEND_EMAIL',
              config: { to: 'qa@example.com', subject: 'Dry run isolation probe' },
            },
            {
              activityId: 'emit',
              activityName: 'emitProbe',
              activityType: 'EMIT_EVENT',
              config: { eventName: 'workflows.qa.dry_run_probe', payload: { probe: true } },
            },
          ],
        },
        {
          transitionId: 'notify-to-review',
          fromStepId: 'notify',
          toStepId: 'review',
          trigger: 'auto',
        },
        {
          transitionId: 'review-to-end',
          fromStepId: 'review',
          toStepId: 'end',
          trigger: 'auto',
        },
      ],
    },
    enabled: true,
  };
}

/**
 * Definition whose first activity REFUSES simulation (`EXECUTE_FUNCTION` declares
 * `mock: 'refuse'`), so a dry run must stop at that node with an explicit marker
 * rather than following an error route.
 */
export function buildDryRunRefusalDefinitionPayload(timestamp: number, suffix = '') {
  return {
    workflowId: `qa-wf-dryrun-refuse-${timestamp}${suffix}`,
    workflowName: `QA Dry Run Refusal ${timestamp}${suffix}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'run', stepName: 'Run', stepType: 'AUTOMATED' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        {
          transitionId: 'start-to-run',
          fromStepId: 'start',
          toStepId: 'run',
          trigger: 'auto',
          activities: [
            {
              activityId: 'custom',
              activityName: 'customFn',
              activityType: 'EXECUTE_FUNCTION',
              config: { functionName: 'qa.noop' },
            },
          ],
        },
        { transitionId: 'run-to-end', fromStepId: 'run', toStepId: 'end', trigger: 'auto' },
      ],
    },
    enabled: true,
  };
}

export async function createWorkflowDefinitionFixture(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/workflows/definitions', { token, data });
  const body = await readJsonSafe<{ data?: { id?: string } }>(response);
  expect(response.status(), `POST /api/workflows/definitions should return 201 (got ${response.status()}: ${JSON.stringify(body)})`).toBe(201);
  return expectId(body?.data?.id, 'Definition creation response should include data.id');
}

export async function deleteWorkflowDefinitionIfExists(
  request: APIRequestContext,
  token: string | null,
  definitionId: string | null,
): Promise<void> {
  if (!token || !definitionId) return;
  await apiRequest(
    request,
    'DELETE',
    `/api/workflows/definitions/${encodeURIComponent(definitionId)}`,
    { token },
  ).catch(() => undefined);
}

export async function startWorkflowInstanceFixture(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/workflows/instances', { token, data });
  const body = await readJsonSafe<{ data?: { instance?: { id?: string } } }>(response);
  expect(response.status(), `POST /api/workflows/instances should return 201 (got ${response.status()}: ${JSON.stringify(body)})`).toBe(201);
  return expectId(body?.data?.instance?.id, 'Instance start response should include data.instance.id');
}

export async function cancelWorkflowInstanceIfExists(
  request: APIRequestContext,
  token: string | null,
  instanceId: string | null,
): Promise<void> {
  if (!token || !instanceId) return;
  await apiRequest(
    request,
    'POST',
    `/api/workflows/instances/${encodeURIComponent(instanceId)}/cancel`,
    { token },
  ).catch(() => undefined);
}

/**
 * Definition with a single USER_TASK queued to a role (not a specific user), so the
 * generated task is claimable. The array form of `assignedTo` is intentional: the step
 * handler stores an array `assignedTo` as `assignedToRoles` (a role queue) and leaves
 * `assignedTo` null — the precondition `claimUserTask` requires. The post-task transition
 * is `auto` so completing the task advances the instance to END (COMPLETED).
 */
export function buildClaimableUserTaskDefinitionPayload(timestamp: number, suffix = '') {
  const id = `qa-wf-claim${suffix}-${timestamp}`;
  return {
    workflowId: id,
    workflowName: `QA Claimable User Task${suffix} ${timestamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'review',
          stepName: 'Review',
          stepType: 'USER_TASK',
          userTaskConfig: {
            assignedTo: ['admin'],
            formSchema: {
              properties: {
                approved: { type: 'boolean' },
                comments: { type: 'string' },
              },
              required: ['approved'],
            },
          },
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-review', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
        { transitionId: 'review-to-end', fromStepId: 'review', toStepId: 'end', trigger: 'auto' },
      ],
    },
    enabled: true,
  };
}

/**
 * Definition with a single USER_TASK assigned directly to one user id, so the generated
 * task carries `assignedTo=<userId>` (and is therefore filterable by `assignedTo`/`myTasks`
 * and NOT claimable from a role queue).
 */
export function buildAssignedUserTaskDefinitionPayload(timestamp: number, assignedUserId: string, suffix = '') {
  const id = `qa-wf-assigned${suffix}-${timestamp}`;
  return {
    workflowId: id,
    workflowName: `QA Assigned User Task${suffix} ${timestamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'review',
          stepName: 'Review',
          stepType: 'USER_TASK',
          userTaskConfig: {
            assignedTo: assignedUserId,
            formSchema: { properties: { approved: { type: 'boolean' } } },
          },
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-review', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
        { transitionId: 'review-to-end', fromStepId: 'review', toStepId: 'end', trigger: 'auto' },
      ],
    },
    enabled: true,
  };
}

/**
 * Definition that pauses at a WAIT_FOR_SIGNAL step until the named signal arrives. The
 * post-signal transition is `auto` so a matching signal resumes the instance to COMPLETED.
 */
export function buildSignalDefinitionPayload(timestamp: number, signalName = 'approval', suffix = '') {
  const id = `qa-wf-signal${suffix}-${timestamp}`;
  return {
    workflowId: id,
    workflowName: `QA Signal Workflow${suffix} ${timestamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'wait', stepName: 'Wait For Signal', stepType: 'WAIT_FOR_SIGNAL', signalConfig: { signalName } },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-wait', fromStepId: 'start', toStepId: 'wait', trigger: 'auto' },
        { transitionId: 'wait-to-end', fromStepId: 'wait', toStepId: 'end', trigger: 'auto' },
      ],
    },
    enabled: true,
  };
}

/**
 * Linear START → mid → END definition whose transitions are all `manual`. The background
 * executor never auto-fires them, so the instance rests at each step (RUNNING) until the
 * `/advance` endpoint moves it on — the precondition for exercising manual progression.
 */
export function buildManualAdvanceDefinitionPayload(timestamp: number, suffix = '') {
  const id = `qa-wf-advance${suffix}-${timestamp}`;
  return {
    workflowId: id,
    workflowName: `QA Manual Advance Workflow${suffix} ${timestamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'mid', stepName: 'Middle', stepType: 'AUTOMATED' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-mid', fromStepId: 'start', toStepId: 'mid', trigger: 'manual' },
        { transitionId: 'mid-to-end', fromStepId: 'mid', toStepId: 'end', trigger: 'manual' },
      ],
    },
    enabled: true,
  };
}

export type WorkflowInstanceSnapshot = {
  id?: string;
  status?: string;
  currentStepId?: string;
  retryCount?: number;
  correlationKey?: string;
  context?: Record<string, unknown>;
};

export async function getWorkflowInstanceSnapshot(
  request: APIRequestContext,
  token: string,
  instanceId: string,
): Promise<WorkflowInstanceSnapshot | null> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/workflows/instances/${encodeURIComponent(instanceId)}`,
    { token },
  );
  if (response.status() !== 200) return null;
  const body = await readJsonSafe<{ data?: WorkflowInstanceSnapshot }>(response);
  return body?.data ?? null;
}

/**
 * Polls instance detail until `predicate` holds or the timeout elapses. Required because
 * `POST /api/workflows/instances` runs execution in a background `setImmediate` callback,
 * so the instance reaches its pause/terminal state asynchronously after the 201 response.
 *
 * An elapsed budget THROWS by default, naming the last status/step it saw. Returning the
 * last snapshot instead turned every engine timeout in this suite into a downstream value
 * mismatch ("expected COMPLETED, received PAUSED") that reads like a routing bug, so the
 * one failure mode a poll actually has was the one it never reported.
 *
 * `onTimeout: 'returnLast'` keeps the old behaviour for the callers that use the budget as
 * a deliberate STALL DETECTOR and have a fallback to run.
 */
export async function pollWorkflowInstance(
  request: APIRequestContext,
  token: string,
  instanceId: string,
  predicate: (instance: WorkflowInstanceSnapshot) => boolean,
  options: { timeoutMs?: number; intervalMs?: number; onTimeout?: 'throw' | 'returnLast' } = {},
): Promise<WorkflowInstanceSnapshot | null> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const intervalMs = options.intervalMs ?? 250;
  const onTimeout = options.onTimeout ?? 'throw';
  const deadline = Date.now() + timeoutMs;
  let last: WorkflowInstanceSnapshot | null = null;
  for (;;) {
    last = await getWorkflowInstanceSnapshot(request, token, instanceId);
    if (last && predicate(last)) return last;
    if (Date.now() >= deadline) {
      if (onTimeout === 'returnLast') return last;
      const seen = last
        ? `status=${last.status} currentStepId=${last.currentStepId ?? 'null'}`
        : 'the instance was never readable';
      throw new Error(
        `[internal] pollWorkflowInstance: instance ${instanceId} did not satisfy the predicate within ${timeoutMs}ms (last seen: ${seen})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Single-USER_TASK definition whose `userTaskConfig` is supplied verbatim by the caller.
 *
 * The Phase-4a task inspector vocabulary (`priority`, `deadline`, `entityBindings`,
 * `assignedToRoles`, `formKey`, `allowedActions`, `instructions`) is all optional and all
 * additive, so a builder per combination would multiply without end. This one takes the
 * config as-is, which also makes it the honest fixture for the A1 regression: what the test
 * posts is exactly what the definition endpoint is asked to persist.
 */
export function buildInspectorUserTaskDefinitionPayload(
  timestamp: number,
  options: {
    suffix?: string;
    userTaskConfig?: Record<string, unknown>;
    /** `auto` resumes the instance to END on completion; `manual` leaves it parked. */
    postTaskTrigger?: 'auto' | 'manual';
    stepName?: string;
  } = {},
) {
  const suffix = options.suffix ?? '';
  const id = `qa-wf-inspector${suffix}-${timestamp}`;
  return {
    workflowId: id,
    workflowName: `QA Inspector User Task${suffix} ${timestamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'review',
          stepName: options.stepName ?? 'Review',
          stepType: 'USER_TASK',
          userTaskConfig: options.userTaskConfig ?? {
            assignedToRoles: ['admin'],
            formSchema: { properties: { approved: { type: 'boolean' } } },
          },
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-review', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
        {
          transitionId: 'review-to-end',
          fromStepId: 'review',
          toStepId: 'end',
          trigger: options.postTaskTrigger ?? 'auto',
        },
      ],
    },
    enabled: true,
  };
}

/**
 * USER_TASK with two decision buttons, each bound 1:1 to its own outgoing route ending at a
 * DIFFERENT END step — so the step the instance finishes on proves which route was taken.
 *
 * Both routes are `manual` on purpose: completion without a decision then finds no `auto`
 * transition and leaves the instance parked, which makes "the decision selected the route"
 * an assertion rather than a coincidence of route order.
 */
export function buildDecisionUserTaskDefinitionPayload(timestamp: number, suffix = '') {
  const id = `qa-wf-decision${suffix}-${timestamp}`;
  return {
    workflowId: id,
    workflowName: `QA Decision User Task${suffix} ${timestamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'review',
          stepName: 'Review',
          stepType: 'USER_TASK',
          userTaskConfig: {
            assignedToRoles: ['admin'],
            formSchema: { properties: { comments: { type: 'string' } } },
            decisions: [
              { id: 'approve', label: 'Approve', transitionId: 'review-to-approved', style: 'primary' },
              { id: 'reject', label: 'Reject', transitionId: 'review-to-rejected', style: 'destructive' },
            ],
          },
        },
        { stepId: 'approved', stepName: 'Approved', stepType: 'END' },
        { stepId: 'rejected', stepName: 'Rejected', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-review', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
        { transitionId: 'review-to-approved', fromStepId: 'review', toStepId: 'approved', trigger: 'manual' },
        { transitionId: 'review-to-rejected', fromStepId: 'review', toStepId: 'rejected', trigger: 'manual' },
      ],
    },
    enabled: true,
  };
}

export type UserTaskSnapshot = {
  id?: string;
  status?: string;
  assignedTo?: string | null;
  assignedToRoles?: string[] | null;
  claimedBy?: string | null;
  completedBy?: string | null;
  completedAt?: string | null;
  workflowInstanceId?: string;
  formData?: Record<string, unknown> | null;
  priority?: string | number | null;
  entityBindings?: unknown[] | null;
  dueDate?: string | null;
  /** SLA escalation bookkeeping (`api/tasks/serialize.ts`). */
  escalatedAt?: string | null;
  escalatedTo?: string | null;
  reassignedAt?: string | null;
  reassignReason?: string | null;
};

/** Task detail adds the DERIVED fields the list cannot carry (see `api/tasks/[id]/route.ts`). */
export type UserTaskDetail = UserTaskSnapshot & {
  stepId?: string | null;
  formKey?: string | null;
  decisions?: Array<{ id: string; label: string; transitionId: string; style?: string }>;
};

export async function getUserTaskDetail(
  request: APIRequestContext,
  token: string,
  taskId: string,
): Promise<UserTaskDetail | null> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/workflows/tasks/${encodeURIComponent(taskId)}`,
    { token },
  );
  if (response.status() !== 200) return null;
  const body = await readJsonSafe<{ data?: UserTaskDetail }>(response);
  return body?.data ?? null;
}

/**
 * One work-inbox row on the wire: the common projection plus the provider payload flattened
 * underneath it (`serializeWorkInboxRow`), which is what keeps a `user_task` row a strict
 * superset of a `GET /api/workflows/tasks` row.
 */
export type WorkInboxRowSnapshot = {
  id?: string;
  kind?: string;
  moduleId?: string;
  title?: string;
  status?: string;
  priority?: string | null;
  dueDate?: string | null;
  overdue?: boolean;
  assignedTo?: string | null;
  assignedToRoles?: string[] | null;
  claimedBy?: string | null;
  entityTypes?: string[];
  entityBindings?: Array<{ entityType?: string; entityId?: string; label?: string | null }>;
  detailHref?: string | null;
  actions?: Array<{ id?: string; labelKey?: string; endpoint?: string; appliesTo?: string }>;
  proposalId?: string | null;
};

export type WorkInboxListBody = {
  data?: WorkInboxRowSnapshot[];
  pagination?: { total?: number; limit?: number; offset?: number; hasMore?: boolean };
  meta?: { kinds?: string[]; degradedKinds?: string[] };
};

export async function listWorkInbox(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<WorkInboxListBody | null> {
  const response = await apiRequest(request, 'GET', `/api/workflows/work-inbox${query}`, { token });
  expect(response.status(), `GET /api/workflows/work-inbox${query} should return 200`).toBe(200);
  return readJsonSafe<WorkInboxListBody>(response);
}

/**
 * Polls the work inbox until `predicate` holds. Tasks are created by the background executor
 * after the instance-start response, so the inbox is eventually — not immediately — populated.
 */
export async function pollWorkInbox(
  request: APIRequestContext,
  token: string,
  query: string,
  predicate: (body: WorkInboxListBody) => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<WorkInboxListBody | null> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const intervalMs = options.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let last: WorkInboxListBody | null = null;
  for (;;) {
    last = await listWorkInbox(request, token, query);
    if (last && predicate(last)) return last;
    if (Date.now() >= deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function listWorkflowInstanceTasks(
  request: APIRequestContext,
  token: string,
  instanceId: string,
): Promise<UserTaskSnapshot[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/workflows/tasks?workflowInstanceId=${encodeURIComponent(instanceId)}`,
    { token },
  );
  if (response.status() !== 200) return [];
  const body = await readJsonSafe<{ data?: UserTaskSnapshot[] }>(response);
  return body?.data ?? [];
}

/**
 * Polls the task list scoped to `instanceId` until a task in one of `statuses` appears
 * (default PENDING/IN_PROGRESS), accommodating the same background-execution delay.
 */
export async function findInstanceUserTask(
  request: APIRequestContext,
  token: string,
  instanceId: string,
  options: { timeoutMs?: number; intervalMs?: number; statuses?: string[] } = {},
): Promise<UserTaskSnapshot | null> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const intervalMs = options.intervalMs ?? 250;
  const statuses = options.statuses ?? ['PENDING', 'IN_PROGRESS'];
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const tasks = await listWorkflowInstanceTasks(request, token, instanceId);
    const match = tasks.find((task) => typeof task.status === 'string' && statuses.includes(task.status));
    if (match?.id) return match;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Register a run-unique CUSTOM ENTITY so a task may legally be bound to it.
 *
 * Spec §6.4's entity clause (`lib/task-visibility.ts` → `evaluateEntityClause`)
 * FAILS CLOSED on a binding whose `entityType` resolves to nothing:
 * `resolveTaskEntityAccess` answers `{ kind: 'unknown-entity-type' }` and the task
 * becomes invisible to every principal except a superadmin — the list route
 * reports it as `diagnostics.entityHidden[].reason = 'denied:unknown-entity-type'`
 * while returning zero rows. A spec that invents an `entityType` purely to scope
 * `?entityType=` against a shared database therefore sees nothing at all.
 *
 * Registering the id as a tenant custom entity makes `classifyRecordsEntity`
 * answer `{ kind: 'custom', restricted: false }`, which requires only
 * `entities.records.view` — held by `admin` — so the binding resolves and the
 * scoping trick works while still exercising the real §6.4 path.
 *
 * `entityId` MUST match `^[a-z0-9_]+:[a-z0-9_]+$` (`entityIdRegex`): underscores,
 * never hyphens.
 */
export async function registerTaskBindingEntityType(
  request: APIRequestContext,
  token: string,
  entityId: string,
  label?: string,
): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/entities/entities', {
    token,
    data: {
      entityId,
      label: label ?? entityId,
      showInSidebar: false,
      accessRestricted: false,
    },
  });
  expect(
    response.status(),
    `POST /api/entities/entities should register ${entityId}, got ${response.status()}`,
  ).toBeLessThan(300);
}

export async function deleteTaskBindingEntityTypeIfExists(
  request: APIRequestContext,
  token: string,
  entityId: string | null,
): Promise<void> {
  if (!entityId) return;
  await apiRequest(request, 'DELETE', '/api/entities/entities', {
    token,
    data: { entityId },
  }).catch(() => undefined);
}

/**
 * Definition whose "agent" step parks on the INVOKE_AGENT proposal-ready signal and
 * declares outcome routes for two of spec §7.2's five disposition kinds.
 *
 * The step parks on a WAIT_FOR_SIGNAL rather than running an agent because the agent
 * runtime lives in `agent_orchestrator`, an OPTIONAL enterprise peer — `executeInvokeAgent`
 * refuses outright when it is absent, so a fixture that invoked one would only ever run
 * where enterprise is installed. Declaring the INVOKE_AGENT activity is what the engine
 * keys outcome routing off (`signal-handler`'s `isInvokeAgentStep`), so the routing under
 * test is the real path a disposition takes, not a lookalike.
 *
 * Routes out of `agent`: the default `agent -> apply -> end` happy path, plus
 * `rejected -> rejected_end` and `guardrailBlocked -> guardrail_end`.
 */
export function buildAgentOutcomeDefinitionPayload(stamp: string, signalName: string) {
  const id = `qa-wf-outcome-${stamp}`;
  return {
    workflowId: id,
    workflowName: `QA Agent Outcome Workflow ${stamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'agent',
          stepName: 'Assess',
          stepType: 'WAIT_FOR_SIGNAL',
          signalConfig: { signalName },
          activities: [
            {
              activityId: 'assess',
              activityName: 'Assess',
              activityType: 'INVOKE_AGENT',
              config: { agentId: 'qa.assessor', input: {}, onResult: { autoApproveThreshold: 0.8 } },
            },
          ],
        },
        { stepId: 'apply', stepName: 'Apply', stepType: 'AUTOMATED' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
        { stepId: 'rejected_end', stepName: 'Rejected', stepType: 'END' },
        { stepId: 'guardrail_end', stepName: 'Guardrail Blocked', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-agent', fromStepId: 'start', toStepId: 'agent', trigger: 'auto' },
        { transitionId: 'agent-to-apply', fromStepId: 'agent', toStepId: 'apply', trigger: 'auto' },
        { transitionId: 'apply-to-end', fromStepId: 'apply', toStepId: 'end', trigger: 'auto' },
        {
          transitionId: 'agent-rejected',
          fromStepId: 'agent',
          toStepId: 'rejected_end',
          trigger: 'auto',
          kind: 'outcome',
          outcomeKind: 'rejected',
        },
        {
          transitionId: 'agent-guardrail',
          fromStepId: 'agent',
          toStepId: 'guardrail_end',
          trigger: 'auto',
          kind: 'outcome',
          outcomeKind: 'guardrailBlocked',
        },
      ],
    },
    enabled: true,
  };
}

/**
 * Single-USER_TASK definition carrying an SLA-breach route (`kind: 'slaBreach'`).
 *
 * The A.1 regression fixture: `graphToDefinition` used to persist only `kind: 'error'`,
 * so opening a definition like this in the Studio and saving it silently downgraded the
 * breach route to a normal transition and the breach stopped routing — with no error
 * anywhere. The route must survive a create → read → update → read round trip.
 */
export function buildSlaBreachRouteDefinitionPayload(stamp: string) {
  const id = `qa-wf-breach-${stamp}`;
  return {
    workflowId: id,
    workflowName: `QA SLA Breach Route Workflow ${stamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'review',
          stepName: 'Review',
          stepType: 'USER_TASK',
          userTaskConfig: { assignedToRoles: ['admin'], allowedActions: ['complete'] },
        },
        { stepId: 'escalate', stepName: 'Escalate', stepType: 'END' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-review', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
        { transitionId: 'review-to-end', fromStepId: 'review', toStepId: 'end', trigger: 'auto' },
        {
          transitionId: 'review-breach',
          fromStepId: 'review',
          toStepId: 'escalate',
          trigger: 'auto',
          kind: 'slaBreach',
        },
      ],
    },
    enabled: true,
  };
}

/**
 * Linear, fully automated START -> prepare -> finish -> END definition. Every route is
 * `auto` and no step carries an activity, so the start call drives it to COMPLETED
 * synchronously — which is the precondition for anything that reads a FINISHED run
 * (the Studio's "Show last run" overlay, the Gantt, the per-step I/O inspector).
 */
export function buildCompletedRunDefinitionPayload(stamp: string, suffix = '') {
  const id = `qa-wf-run${suffix}-${stamp}`;
  return {
    workflowId: id,
    workflowName: `QA Completed Run${suffix} ${stamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'prepare', stepName: 'Prepare', stepType: 'AUTOMATED' },
        { stepId: 'finish', stepName: 'Finish', stepType: 'AUTOMATED' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-prepare', fromStepId: 'start', toStepId: 'prepare', trigger: 'auto' },
        { transitionId: 'prepare-to-finish', fromStepId: 'prepare', toStepId: 'finish', trigger: 'auto' },
        { transitionId: 'finish-to-end', fromStepId: 'finish', toStepId: 'end', trigger: 'auto' },
      ],
    },
    enabled: true,
  };
}

/**
 * START -> mid -> boom -> END, where `boom` carries a STEP-level activity that cannot
 * succeed: `EXECUTE_FUNCTION` names a `functionName` that no module registers, so the
 * activity fails on the first attempt with a stable message (`Workflow function "…" not
 * registered in DI container`) and no external dependency. The key MUST be `functionName`
 * — `REQUIRED_ACTIVITY_CONFIG_KEYS` rejects the definition at CREATE time otherwise, so a
 * config declaring `functionId` never reaches a run at all. `mid` reaches COMPLETED
 * before it, which is what makes the run a legal
 * rerun target (spec 8.4 eligibility reads the LATEST attempt of the requested step and
 * requires it to be terminal).
 *
 * `errorDirective: 'failureQueue'` switches the same fixture from "the instance FAILS" to
 * "the instance PARKS with `metadata.attention`" — the two halves of the spec 8.4 failure
 * queue, which is a UNION of those states rather than a filter over one of them.
 *
 * The activity is on the STEP, not on the outgoing transition, on purpose: a transition
 * activity attributes the failure to the step the route LEAVES, which would make `mid` the
 * failing step and leave nothing completed behind it.
 */
export function buildFailingStepDefinitionPayload(
  stamp: string,
  options: { suffix?: string; errorDirective?: 'fail' | 'continueWithFallback' | 'failureQueue' } = {},
) {
  const suffix = options.suffix ?? '';
  const id = `qa-wf-fail${suffix}-${stamp}`;
  return {
    workflowId: id,
    workflowName: `QA Failing Step${suffix} ${stamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'mid', stepName: 'Mid', stepType: 'AUTOMATED' },
        {
          stepId: 'boom',
          stepName: 'Boom',
          stepType: 'AUTOMATED',
          ...(options.errorDirective ? { errorDirective: { mode: options.errorDirective } } : {}),
          activities: [
            {
              activityId: 'boom',
              activityName: 'Boom',
              activityType: 'EXECUTE_FUNCTION',
              config: { functionName: 'qa-nonexistent-function-do-not-register' },
            },
          ],
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-mid', fromStepId: 'start', toStepId: 'mid', trigger: 'auto' },
        { transitionId: 'mid-to-boom', fromStepId: 'mid', toStepId: 'boom', trigger: 'auto' },
        { transitionId: 'boom-to-end', fromStepId: 'boom', toStepId: 'end', trigger: 'auto' },
      ],
    },
    enabled: true,
  };
}

/**
 * A review task whose step is AGENT-SHAPED, carrying a deadline and an authored
 * `onBreach` escalation (spec section 7.5).
 *
 * The step is a `USER_TASK` that ALSO declares an `INVOKE_AGENT` activity, and
 * that combination is deliberate. `applyBreachHandling` (`lib/task-sla.ts`)
 * chooses between the full USER_TASK breach vocabulary and the escalate-only
 * agent-review one STRUCTURALLY — `isInvokeAgentStepDef` asks only whether the
 * step declares an `INVOKE_AGENT` activity — so this is the exact input the
 * production disposition path presents, without needing `agent_orchestrator`
 * (an optional enterprise peer) or a real model round trip to write the row.
 * `handleUserTaskStep` reads `userTaskConfig` only, so the declared activity is
 * never executed and the absent peer is never reached.
 *
 * The fixture also asks — twice, as loudly as a definition can — for the run to
 * be ROUTED on breach: `userTaskConfig.onBreach = { action: 'route' }` plus a
 * wired `kind: 'slaBreach'` transition to `escalate`. Neither may be honoured on
 * an agent step, and that refusal is the thing under test.
 */
export function buildAgentReviewDeadlineDefinitionPayload(
  stamp: string,
  options: {
    suffix?: string;
    deadlineDuration: string;
    onBreach: { action: 'notify' | 'reassign' | 'attention'; reassignTo?: string };
    assignedToRoles?: string[];
  },
) {
  const suffix = options.suffix ?? '';
  const id = `qa-wf-review${suffix}-${stamp}`;
  return {
    workflowId: id,
    workflowName: `QA Agent Review Deadline${suffix} ${stamp}`,
    description: `Integration test definition ${id}`,
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'agent_review',
          stepName: 'Dispose agent proposal',
          stepType: 'USER_TASK',
          userTaskConfig: {
            assignedToRoles: options.assignedToRoles ?? ['admin'],
            allowedActions: ['complete'],
            deadline: { duration: options.deadlineDuration },
            // The USER_TASK vocabulary asking to route. Must be ignored here.
            onBreach: { action: 'route', transitionId: 'review-breach' },
          },
          activities: [
            {
              activityId: 'assess',
              activityName: 'Assess',
              activityType: 'INVOKE_AGENT',
              config: {
                agentId: 'qa.assessor',
                input: {},
                onResult: { autoApproveThreshold: 0.8 },
                review: {
                  deadline: { duration: options.deadlineDuration },
                  onBreach: options.onBreach,
                },
              },
            },
          ],
        },
        { stepId: 'escalate', stepName: 'Escalate', stepType: 'END' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-review', fromStepId: 'start', toStepId: 'agent_review', trigger: 'auto' },
        { transitionId: 'review-to-end', fromStepId: 'agent_review', toStepId: 'end', trigger: 'manual' },
        // The breach route the engine must refuse to follow on an agent step.
        {
          transitionId: 'review-breach',
          fromStepId: 'agent_review',
          toStepId: 'escalate',
          trigger: 'auto',
          kind: 'slaBreach',
        },
      ],
    },
    enabled: true,
  };
}

export type WorkflowEventSnapshot = {
  id?: string;
  eventType?: string;
  eventData?: Record<string, unknown> | null;
  userId?: string | null;
  occurredAt?: string;
};

/**
 * Instance event log, optionally narrowed to one event type. The event log is the ONLY
 * audit surface for things that leave no row of their own (a taken transition, a rerun),
 * so a test asserting an audit trail has to read it rather than infer from state.
 */
export async function listWorkflowInstanceEvents(
  request: APIRequestContext,
  token: string,
  instanceId: string,
  options: { eventType?: string; limit?: number } = {},
): Promise<WorkflowEventSnapshot[]> {
  const params = new URLSearchParams({ limit: String(options.limit ?? 100) });
  if (options.eventType) params.set('eventType', options.eventType);
  const response = await apiRequest(
    request,
    'GET',
    `/api/workflows/instances/${encodeURIComponent(instanceId)}/events?${params.toString()}`,
    { token },
  );
  expect(response.status(), `GET instance events should return 200 (got ${response.status()})`).toBe(200);
  const body = await readJsonSafe<{ data?: WorkflowEventSnapshot[] }>(response);
  return body?.data ?? [];
}

export type StepInstanceSnapshot = {
  id?: string;
  stepId?: string;
  stepType?: string;
  status?: string;
  inputData?: Record<string, unknown> | null;
  outputData?: Record<string, unknown> | null;
  errorData?: Record<string, unknown> | null;
  enteredAt?: string | null;
  exitedAt?: string | null;
  executionTimeMs?: number | null;
  retryCount?: number;
};

/** `GET api/instances/[id]/steps` — the spec 8.3 read surface for `StepInstance` rows. */
export async function listWorkflowInstanceSteps(
  request: APIRequestContext,
  token: string,
  instanceId: string,
): Promise<StepInstanceSnapshot[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/workflows/instances/${encodeURIComponent(instanceId)}/steps?limit=100`,
    { token },
  );
  expect(response.status(), `GET instance steps should return 200 (got ${response.status()})`).toBe(200);
  const body = await readJsonSafe<{ data?: StepInstanceSnapshot[] }>(response);
  return body?.data ?? [];
}

export type FailureQueueGroupSnapshot = {
  key?: string;
  label?: string;
  count?: number;
  workflowIds?: string[];
  instanceIds?: string[];
};

export type FailureQueueBody = {
  // `attentionReason` and `outcome` are the two non-status arms of the union:
  // a row can be here because it is parked, or because its verdict says so.
  data?: Array<{
    id?: string;
    status?: string;
    retryCount?: number;
    errorMessage?: string | null;
    attentionReason?: string | null;
    outcome?: string | null;
  }>;
  groups?: FailureQueueGroupSnapshot[];
  grouping?: { scannedCount?: number; scanLimit?: number; truncated?: boolean };
  pagination?: { total?: number; limit?: number; offset?: number; hasMore?: boolean };
};

/**
 * `GET api/instances/failure-queue` — the spec 8.4 triage union (attention-parked PLUS
 * FAILED). Shared-database safe by construction: callers must assert on their OWN instance
 * ids, never on the total.
 */
export async function getWorkflowFailureQueue(
  request: APIRequestContext,
  token: string,
  query = 'limit=100',
): Promise<FailureQueueBody | null> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/workflows/instances/failure-queue?${query}`,
    { token },
  );
  expect(response.status(), `GET failure-queue should return 200 (got ${response.status()})`).toBe(200);
  return readJsonSafe<FailureQueueBody>(response);
}
