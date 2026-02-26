import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';

export async function createStaffTeamFixture(
  request: APIRequestContext,
  token: string,
  name?: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/staff/teams', {
    token,
    data: { name: name ?? `QA Team ${Date.now()}` },
  });
  expect(response.ok(), `Failed to create staff team fixture: ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as { id?: string };
  expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy();
  return body.id as string;
}

export async function createStaffTeamMemberFixture(
  request: APIRequestContext,
  token: string,
  input?: { displayName?: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/staff/team-members', {
    token,
    data: { displayName: input?.displayName ?? `QA Member ${Date.now()}` },
  });
  expect(response.ok(), `Failed to create staff team member fixture: ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as { id?: string };
  expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy();
  return body.id as string;
}

export async function createStaffTeamRoleFixture(
  request: APIRequestContext,
  token: string,
  input?: { name?: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/staff/team-roles', {
    token,
    data: { name: input?.name ?? `QA Role ${Date.now()}` },
  });
  expect(response.ok(), `Failed to create staff team role fixture: ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as { id?: string };
  expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy();
  return body.id as string;
}

export async function deleteStaffEntityIfExists(
  request: APIRequestContext,
  token: string | null,
  path: string,
  id: string | null,
): Promise<void> {
  if (!token || !id) return;
  try {
    await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token });
  } catch {
    return;
  }
}
