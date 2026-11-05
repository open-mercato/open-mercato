import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';
import { expectId, readJsonSafe } from './generalFixtures';

export async function createNotificationFixture(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/notifications', { token, data });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), 'POST /api/notifications should return 201').toBe(201);
  return expectId(body?.id, 'Notification creation response should include id');
}

export async function listNotifications(
  request: APIRequestContext,
  token: string,
  query?: Record<string, string | number | undefined>,
): Promise<{
  items: Array<Record<string, unknown>>;
  total: number;
}> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const path = `/api/notifications${params.toString() ? `?${params.toString()}` : ''}`;
  const response = await apiRequest(request, 'GET', path, { token });
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>>; total?: number }>(response);
  expect(response.ok(), `GET ${path} should succeed`).toBeTruthy();
  return {
    items: body?.items ?? [],
    total: body?.total ?? 0,
  };
}

export async function dismissNotificationIfExists(
  request: APIRequestContext,
  token: string | null,
  notificationId: string | null,
): Promise<void> {
  if (!token || !notificationId) return;
  await apiRequest(
    request,
    'PUT',
    `/api/notifications/${encodeURIComponent(notificationId)}/dismiss`,
    { token },
  ).catch(() => undefined);
}

export async function dismissNotificationsByType(
  request: APIRequestContext,
  token: string | null,
  type: string | null,
): Promise<void> {
  if (!token || !type) return;
  const notifications = await listNotifications(request, token, { type, pageSize: 100 }).catch(() => null);
  if (!notifications) return;
  await Promise.all(
    notifications.items
      .map((item) => (typeof item.id === 'string' ? item.id : null))
      .filter((id): id is string => Boolean(id))
      .map((id) => dismissNotificationIfExists(request, token, id)),
  );
}
