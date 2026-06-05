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
                { name: 'approved', type: 'boolean', required: true },
                { name: 'comments', type: 'string' },
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
 * Returns the last snapshot seen (so callers can assert on a timeout too).
 */
export async function pollWorkflowInstance(
  request: APIRequestContext,
  token: string,
  instanceId: string,
  predicate: (instance: WorkflowInstanceSnapshot) => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<WorkflowInstanceSnapshot | null> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const intervalMs = options.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let last: WorkflowInstanceSnapshot | null = null;
  for (;;) {
    last = await getWorkflowInstanceSnapshot(request, token, instanceId);
    if (last && predicate(last)) return last;
    if (Date.now() >= deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
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
};

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
