import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';

/**
 * TC-CRM-6068: profile task totals count adapter-created tasks (#6068)
 *
 * Spec: .ai/specs/2026-10-03-customer-task-count-badge.md
 *
 * In the default compatibility storage mode, `POST /api/customers/todos` writes
 * `adapter:todo` interactions instead of `customer_todo_links` rows. The person
 * and company overview routes must count those tasks in `counts.todos` (and the
 * person profile Tasks tab badge must show the same total), keep completed tasks
 * in the total, drop deleted ones, and — against a real Postgres — suppress a
 * legacy link bridged by an adapter interaction even after that interaction is
 * deleted, while still counting an unbridged legacy link.
 *
 * Endpoints:
 *   - POST/PUT/DELETE /api/customers/todos
 *   - GET /api/customers/people/:id
 *   - GET /api/customers/companies/:id
 *   - /backend/customers/people-v2/:id (Tasks tab badge)
 */

type CustomerDetailBody = {
  interactionMode?: 'canonical' | 'legacy';
  counts?: { todos?: number };
};

async function readCustomerDetail(
  request: APIRequestContext,
  token: string,
  path: string,
): Promise<CustomerDetailBody> {
  const response = await apiRequest(request, 'GET', path, { token });
  expect(response.ok(), `GET ${path} should return 200`).toBeTruthy();
  return (await readJsonSafe<CustomerDetailBody>(response)) ?? {};
}

async function readTodoCount(request: APIRequestContext, token: string, path: string): Promise<number | undefined> {
  const detail = await readCustomerDetail(request, token, path);
  return detail.counts?.todos;
}

async function createTask(
  request: APIRequestContext,
  token: string,
  entityId: string,
  title: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/customers/todos', {
    token,
    data: { entityId, title },
  });
  expect(response.status(), 'POST /api/customers/todos should create the task').toBe(201);
  const body = await readJsonSafe<{ todoId?: string }>(response);
  expect(typeof body?.todoId, 'task create response should include todoId').toBe('string');
  return body?.todoId as string;
}

async function completeTask(request: APIRequestContext, token: string, todoId: string): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/customers/todos', {
    token,
    data: { id: todoId, isDone: true },
  });
  expect(response.ok(), 'PUT /api/customers/todos should complete the task').toBeTruthy();
}

async function deleteTask(request: APIRequestContext, token: string, todoId: string): Promise<void> {
  const response = await apiRequest(request, 'DELETE', '/api/customers/todos', {
    token,
    data: { id: todoId },
  });
  expect(response.ok(), 'DELETE /api/customers/todos should delete the task').toBeTruthy();
}

async function deleteTasksIfExist(
  request: APIRequestContext,
  token: string | null,
  todoIds: readonly string[],
): Promise<void> {
  if (!token) return;
  for (const todoId of todoIds) {
    try {
      await apiRequest(request, 'DELETE', '/api/customers/todos', { token, data: { id: todoId } });
    } catch {
      continue;
    }
  }
}

async function insertLegacyTodoLinks(entityId: string, todoIds: readonly string[]): Promise<string[]> {
  return withClient(async (client) => {
    const linkIds: string[] = [];
    for (const todoId of todoIds) {
      const result = await client.query<{ id: string }>(
        `insert into customer_todo_links (id, organization_id, tenant_id, todo_id, todo_source, created_at, entity_id)
         select gen_random_uuid(), organization_id, tenant_id, $2, 'example:todo', now(), id
         from customer_entities
         where id = $1
         returning id`,
        [entityId, todoId],
      );
      expect(result.rows, 'legacy todo link fixture should be inserted').toHaveLength(1);
      linkIds.push(result.rows[0].id);
    }
    return linkIds;
  });
}

async function deleteLegacyTodoLinks(linkIds: readonly string[]): Promise<void> {
  if (linkIds.length === 0) return;
  await withClient(async (client) => {
    await client.query('delete from customer_todo_links where id = any($1::uuid[])', [linkIds]);
  });
}

test.describe('TC-CRM-6068: profile task totals count adapter-created tasks', () => {
  test('person overview counts adapter tasks, keeps completed ones and drops deleted ones', async ({ request }) => {
    let token: string | null = null;
    let personId: string | null = null;
    const todoIds: string[] = [];
    const stamp = Date.now();

    try {
      token = await getAuthToken(request);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CRM6068P${stamp}`,
        displayName: `QA TC-CRM-6068 Person ${stamp}`,
      });
      const detailPath = `/api/customers/people/${personId}`;

      expect(await readTodoCount(request, token, detailPath)).toBe(0);

      todoIds.push(await createTask(request, token, personId, `TC-CRM-6068 person task A ${stamp}`));
      todoIds.push(await createTask(request, token, personId, `TC-CRM-6068 person task B ${stamp}`));
      expect(await readTodoCount(request, token, detailPath)).toBe(2);

      await completeTask(request, token, todoIds[0]);
      expect(await readTodoCount(request, token, detailPath)).toBe(2);

      await deleteTask(request, token, todoIds[1]);
      expect(await readTodoCount(request, token, detailPath)).toBe(1);
    } finally {
      await deleteTasksIfExist(request, token, todoIds);
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
    }
  });

  test('company overview counts adapter tasks and drops deleted ones', async ({ request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    const todoIds: string[] = [];
    const stamp = Date.now();

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-6068 Company ${stamp}`);
      const detailPath = `/api/customers/companies/${companyId}`;

      expect(await readTodoCount(request, token, detailPath)).toBe(0);

      todoIds.push(await createTask(request, token, companyId, `TC-CRM-6068 company task A ${stamp}`));
      todoIds.push(await createTask(request, token, companyId, `TC-CRM-6068 company task B ${stamp}`));
      expect(await readTodoCount(request, token, detailPath)).toBe(2);

      await completeTask(request, token, todoIds[0]);
      expect(await readTodoCount(request, token, detailPath)).toBe(2);

      await deleteTask(request, token, todoIds[1]);
      expect(await readTodoCount(request, token, detailPath)).toBe(1);
    } finally {
      await deleteTasksIfExist(request, token, todoIds);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });

  test('compatibility total suppresses bridged legacy links, including deleted bridges', async ({ request }) => {
    let token: string | null = null;
    let personId: string | null = null;
    let legacyLinkIds: string[] = [];
    const todoIds: string[] = [];
    const stamp = Date.now();

    try {
      token = await getAuthToken(request);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CRM6068L${stamp}`,
        displayName: `QA TC-CRM-6068 Legacy ${stamp}`,
      });
      const detailPath = `/api/customers/people/${personId}`;

      todoIds.push(await createTask(request, token, personId, `TC-CRM-6068 bridged task ${stamp}`));
      const bridgedTodoId = todoIds[0];
      const unbridgedTodoId = randomUUID();
      legacyLinkIds = await insertLegacyTodoLinks(personId, [bridgedTodoId, unbridgedTodoId]);

      const detail = await readCustomerDetail(request, token, detailPath);
      test.skip(
        detail.interactionMode === 'canonical',
        'Unified interaction mode counts task interactions only; legacy link merging applies to compatibility mode.',
      );
      expect(detail.counts?.todos, 'bridged link counts once, unbridged link counts').toBe(2);

      await deleteTask(request, token, bridgedTodoId);
      expect(
        await readTodoCount(request, token, detailPath),
        'a deleted bridge keeps suppressing its legacy link',
      ).toBe(1);
    } finally {
      await deleteLegacyTodoLinks(legacyLinkIds);
      await deleteTasksIfExist(request, token, todoIds);
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
    }
  });

  test('person profile Tasks tab badge shows the adapter task total', async ({ page, request }) => {
    test.slow();

    let token: string | null = null;
    let personId: string | null = null;
    const todoIds: string[] = [];
    const stamp = Date.now();
    const displayName = `QA TC-CRM-6068 Badge ${stamp}`;

    try {
      token = await getAuthToken(request);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CRM6068B${stamp}`,
        displayName,
      });
      todoIds.push(await createTask(request, token, personId, `TC-CRM-6068 badge task A ${stamp}`));
      todoIds.push(await createTask(request, token, personId, `TC-CRM-6068 badge task B ${stamp}`));

      await login(page, 'admin');
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.goto(`/backend/customers/people-v2/${personId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: displayName, exact: true })).toBeVisible({ timeout: 15_000 });

      const tasksTab = page.getByRole('tab', { name: /^Tasks\b/ });
      await expect(tasksTab).toHaveCount(1);
      await expect(tasksTab.locator('[data-slot="tabs-trigger-count"]')).toHaveText('2');
    } finally {
      await deleteTasksIfExist(request, token, todoIds);
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
    }
  });
});
