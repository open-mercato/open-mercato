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
