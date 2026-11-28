import { randomUUID } from 'node:crypto';
import { expect, test, type APIResponse } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createPersonFixture, readJsonSafe } from '@open-mercato/core/helpers/integration/crmFixtures';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import { expectId, getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';

export const integrationMeta = { dependsOnModules: ['example', 'dashboards'] };

const widgetId = 'customers.dashboard.todos';
const interactionsPath = '/api/customers/interactions';
const todosPath = '/api/example/todos';

function expectSuccess(response: APIResponse): void {
  expect(response.ok(), `${response.url()} returned ${response.status()}`).toBeTruthy();
}

test('TC-CRM-8500: Customer Tasks hides source IDs and preserves record links', async ({ page, request }) => {
  test.slow();
  const token = await getAuthToken(request, 'admin');
  const scope = getTokenScope(token);
  const marker = randomUUID();
  const displayName = `Dashboard person ${marker}`;
  const canonicalTitle = `Customer follow-up ${marker}`;
  const externalTitle = `External follow-up ${marker}`;
  const linkId = randomUUID();
  let personId: string | undefined;
  let interactionId: string | undefined;
  let todoId: string | undefined;
  let linkAttempted = false;

  try {
    personId = await createPersonFixture(request, token, {
      firstName: 'Dashboard',
      lastName: marker,
      displayName,
    });
    const interaction = await apiRequest(request, 'POST', interactionsPath, {
      token,
      data: { entityId: personId, interactionType: 'task', title: canonicalTitle },
    });
    interactionId = expectId((await readJsonSafe<{ id?: string }>(interaction))?.id, 'Created customer interaction ID');
    expect(interaction.status()).toBe(201);

    const todo = await apiRequest(request, 'POST', todosPath, { token, data: { title: externalTitle } });
    todoId = expectId((await readJsonSafe<{ id?: string }>(todo))?.id, 'Created example task ID');
    expect(todo.status()).toBe(201);

    linkAttempted = true;
    await withClient(async (client) => {
      const result = await client.query(
        `insert into customer_todo_links
          (id, organization_id, tenant_id, todo_id, todo_source, created_at, entity_id, created_by_user_id)
         select $1, organization_id, tenant_id, $2, 'example:todo', now(), id, $6
         from customer_entities
         where id = $3 and tenant_id = $4 and organization_id = $5`,
        [linkId, todoId, personId, scope.tenantId, scope.organizationId, scope.userId],
      );
      expect(result.rowCount).toBe(1);
    });

    await login(page, 'admin');
    await page.route('**/api/dashboards/layout', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      const layout = await response.json();
      await route.fulfill({
        response,
        json: {
          ...layout,
          layout: {
            ...layout.layout,
            items: [{ id: marker, widgetId, order: 0, priority: 0, size: 'md', settings: { pageSize: 20 } }],
          },
        },
      });
    });

    await page.goto('/backend');
    const canonicalRow = page.getByRole('listitem').filter({ hasText: canonicalTitle });
    const externalRow = page.getByRole('listitem').filter({ hasText: externalTitle });
    const customerPath = `/backend/customers/people-v2/${personId}`;
    const todoPath = `/backend/todos/${todoId}/edit`;

    await expect(canonicalRow.getByText(canonicalTitle, { exact: true })).toBeVisible();
    await expect(externalRow.getByText(externalTitle, { exact: true })).toBeVisible();
    for (const row of [canonicalRow, externalRow]) {
      await expect(row.getByText(/customers:interaction|example:todo/)).toHaveCount(0);
      await expect(row.getByRole('link', { name: 'View record' })).toHaveAttribute('href', customerPath);
    }
    await expect(canonicalRow.getByRole('link')).toHaveCount(1);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(canonicalRow).toBeVisible();
    await expect(externalRow).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.setViewportSize({ width: 1280, height: 800 });

    await canonicalRow.getByRole('link', { name: 'View record' }).click();
    await expect(page).toHaveURL(new RegExp(`${customerPath}$`));
    await expect(page.getByText(displayName, { exact: true }).first()).toBeVisible();

    await page.goto('/backend');
    const openTask = externalRow.getByRole('link', { name: 'Open task' });
    await expect(openTask).toHaveAttribute('href', todoPath);
    await openTask.click();
    await expect(page).toHaveURL(new RegExp(`${todoPath}$`));
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(externalTitle);
  } finally {
    const cleanupFailures: unknown[] = [];
    const cleanup = async (action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (error) {
        cleanupFailures.push(error);
      }
    };
    if (linkAttempted) {
      await cleanup(() => withClient((client) => client.query(
        'delete from customer_todo_links where id = $1 and tenant_id = $2 and organization_id = $3',
        [linkId, scope.tenantId, scope.organizationId],
      )));
    }
    for (const [path, id] of [[interactionsPath, interactionId], [todosPath, todoId], ['/api/customers/people', personId]]) {
      if (id) {
        await cleanup(async () => {
          const response = await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token });
          expectSuccess(response);
        });
      }
    }
    expect(cleanupFailures, 'all owned fixtures should be removed').toEqual([]);
  }
});
