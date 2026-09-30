import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-025: Customer Interaction Adapters
 *
 * Verifies that legacy CRM adapter routes keep returning deprecation headers
 * while persisting canonical interactions that remain visible through the
 * legacy fallback reads and detail payloads.
 */
test.describe('TC-CRM-025: Customer Interaction Adapters', () => {
  test('should create and remove a task through /api/customers/todos with legacy fallback reads', async ({ request }) => {
    let token: string | null = null;
    let personId: string | null = null;
    let todoId: string | null = null;

    try {
      token = await getAuthToken(request);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CRM025T${Date.now()}`,
        displayName: `QA TC-CRM-025 Task ${Date.now()}`,
      });

      const createResponse = await apiRequest(request, 'POST', '/api/customers/todos', {
        token,
        data: {
          entityId: personId,
          title: 'TC-CRM-025 Follow up task',
          todoCustom: {
            priority: 4,
            description: 'Adapter-created task',
          },
        },
      });
      expect(createResponse.status()).toBe(201);
      expect(createResponse.headers()['deprecation']).toBe('true');
      const created = await readJsonSafe<Record<string, unknown>>(createResponse);
      todoId = typeof created?.todoId === 'string' ? created.todoId : null;
      expect(todoId).toBeTruthy();

      const listResponse = await apiRequest(request, 'GET', `/api/customers/todos?entityId=${personId}`, { token });
      expect(listResponse.ok()).toBeTruthy();
      expect(listResponse.headers()['deprecation']).toBe('true');
      const listBody = await readJsonSafe<Record<string, unknown>>(listResponse);
      const items = Array.isArray(listBody?.items) ? (listBody!.items as Array<Record<string, unknown>>) : [];
      const createdRow = items.find((item) => item.todoId === todoId);
      expect(createdRow).toBeTruthy();
      expect(createdRow?.todoTitle).toBe('TC-CRM-025 Follow up task');
      expect(createdRow?.todoSource).toBe('customers:interaction');

      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/people/${personId}?include=interactions,todos`,
        { token },
      );
      expect(detailResponse.ok()).toBeTruthy();
      const detailBody = await readJsonSafe<Record<string, unknown>>(detailResponse);
      expect(detailBody?.interactionMode === 'legacy' || detailBody?.interactionMode === 'canonical').toBeTruthy();
      const detailTodos = Array.isArray(detailBody?.todos) ? (detailBody!.todos as Array<Record<string, unknown>>) : [];
      expect(detailTodos.some((item) => item.todoId === todoId)).toBeTruthy();

      const deleteResponse = await apiRequest(request, 'DELETE', '/api/customers/todos', {
        token,
        data: { id: todoId },
      });
      expect(deleteResponse.ok()).toBeTruthy();
      expect(deleteResponse.headers()['deprecation']).toBe('true');

      const listAfterDelete = await apiRequest(request, 'GET', `/api/customers/todos?entityId=${personId}`, { token });
      expect(listAfterDelete.ok()).toBeTruthy();
      const listAfterDeleteBody = await readJsonSafe<Record<string, unknown>>(listAfterDelete);
      const itemsAfterDelete = Array.isArray(listAfterDeleteBody?.items)
        ? (listAfterDeleteBody!.items as Array<Record<string, unknown>>)
        : [];
      expect(itemsAfterDelete.some((item) => item.todoId === todoId)).toBeFalsy();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
    }
  });

  test('should create and remove an activity through /api/customers/activities with legacy fallback reads', async ({ request }) => {
    let token: string | null = null;
    let personId: string | null = null;
    let activityId: string | null = null;

    try {
      token = await getAuthToken(request);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CRM025A${Date.now()}`,
        displayName: `QA TC-CRM-025 Activity ${Date.now()}`,
      });

      const createResponse = await apiRequest(request, 'POST', '/api/customers/activities', {
        token,
        data: {
          entityId: personId,
          activityType: 'note',
          subject: 'TC-CRM-025 adapter note',
          body: 'Adapter-created activity',
        },
      });
      expect(createResponse.status()).toBe(201);
      expect(createResponse.headers()['deprecation']).toBe('true');
      const created = await readJsonSafe<Record<string, unknown>>(createResponse);
      activityId = typeof created?.id === 'string' ? created.id : null;
      expect(activityId).toBeTruthy();

      const listResponse = await apiRequest(request, 'GET', `/api/customers/activities?entityId=${personId}`, { token });
      expect(listResponse.ok()).toBeTruthy();
      expect(listResponse.headers()['deprecation']).toBe('true');
      const listBody = await readJsonSafe<Record<string, unknown>>(listResponse);
      const items = Array.isArray(listBody?.items) ? (listBody!.items as Array<Record<string, unknown>>) : [];
      const createdRow = items.find((item) => item.id === activityId);
      expect(createdRow).toBeTruthy();
      expect(createdRow?.subject).toBe('TC-CRM-025 adapter note');

      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/people/${personId}?include=activities,interactions`,
        { token },
      );
      expect(detailResponse.ok()).toBeTruthy();
      const detailBody = await readJsonSafe<Record<string, unknown>>(detailResponse);
      expect(detailBody?.interactionMode === 'legacy' || detailBody?.interactionMode === 'canonical').toBeTruthy();
      const detailActivities = Array.isArray(detailBody?.activities)
        ? (detailBody!.activities as Array<Record<string, unknown>>)
        : [];
      expect(detailActivities.some((item) => item.id === activityId)).toBeTruthy();

      const deleteResponse = await apiRequest(request, 'DELETE', '/api/customers/activities', {
        token,
        data: { id: activityId },
      });
      expect(deleteResponse.ok()).toBeTruthy();
      expect(deleteResponse.headers()['deprecation']).toBe('true');

      const listAfterDelete = await apiRequest(request, 'GET', `/api/customers/activities?entityId=${personId}`, { token });
      expect(listAfterDelete.ok()).toBeTruthy();
      const listAfterDeleteBody = await readJsonSafe<Record<string, unknown>>(listAfterDelete);
      const itemsAfterDelete = Array.isArray(listAfterDeleteBody?.items)
        ? (listAfterDeleteBody!.items as Array<Record<string, unknown>>)
        : [];
      expect(itemsAfterDelete.some((item) => item.id === activityId)).toBeFalsy();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
    }
  });
});
