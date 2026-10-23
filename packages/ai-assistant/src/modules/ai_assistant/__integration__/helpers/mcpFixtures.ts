import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { createDealFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * Shared fixtures for the MCP exposure / audit / mutation-mode specs
 * (TC-AI-MCP-*). Everything is created through public APIs and removed in the
 * caller's `finally`.
 */

export const TOOLS_PATH = '/api/ai_assistant/tools';
export const EXECUTE_PATH = '/api/ai_assistant/tools/execute';
export const ACTIONS_PATH = '/api/ai_assistant/ai/actions';
export const ACCESS_LOGS_PATH = '/api/audit_logs/audit-logs/access';
export const PENDING_ACTIONS_PAGE = '/backend/config/ai-assistant/pending-actions';
export const MCP_AUDIT_RESOURCE_KIND = 'ai_assistant.mcp_tool_call';
export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const DEAL_MUTATION_TOOL = 'customers.update_deal_stage';
export const DEAL_READ_TOOL = 'customers.list_deals';
export const GET_PENDING_ACTION_TOOL = 'ai_assistant.get_pending_action';
export const DEAL_INITIAL_STATUS = 'open';
export const DEAL_TARGET_STATUS = 'in_progress';
export const FIXTURE_PASSWORD = 'Secret123!';
export const REQUESTER_FEATURES = ['ai_assistant.view', 'customers.deals.view', 'customers.deals.manage'];
export const APPROVER_FEATURES = [...REQUESTER_FEATURES, 'ai_assistant.pending_actions.approve'];

export type ScopedUserFixture = {
  userId: string;
  roleId: string;
  email: string;
  token: string;
};

export type PendingApprovalResponse = {
  success?: boolean;
  status?: string;
  pendingActionId?: string;
  expiresAt?: string;
};

export type PendingActionDetail = {
  id: string;
  toolName: string;
  status: string;
  channel?: string | null;
  requester?: { userId: string | null; apiKeyId: string | null } | null;
  normalizedInput?: unknown;
};

export function uniqueStamp(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export async function createScopedUser(
  request: APIRequestContext,
  adminToken: string,
  input: { label: string; features: string[] },
): Promise<ScopedUserFixture> {
  const { organizationId } = getTokenScope(adminToken);
  const stamp = uniqueStamp();
  const email = `it-mcp-${input.label}-${stamp}@example.com`;
  const roleId = await createRoleFixture(request, adminToken, { name: `IT MCP ${input.label} ${stamp}` });
  await setRoleAclFeatures(request, adminToken, { roleId, features: input.features, organizations: null });
  const userId = await createUserFixture(request, adminToken, {
    email,
    password: FIXTURE_PASSWORD,
    organizationId,
    roles: [roleId],
  });
  const token = await getAuthToken(request, email, FIXTURE_PASSWORD);
  return { userId, roleId, email, token };
}

export async function deleteScopedUser(
  request: APIRequestContext,
  adminToken: string | null,
  fixture: ScopedUserFixture | null,
): Promise<void> {
  if (!fixture) return;
  await deleteUserIfExists(request, adminToken, fixture.userId);
  await deleteRoleIfExists(request, adminToken, fixture.roleId);
}

export async function createOpenDeal(request: APIRequestContext, token: string): Promise<string> {
  return createDealFixture(request, token, {
    title: `IT MCP deal ${uniqueStamp()}`,
    status: DEAL_INITIAL_STATUS,
  });
}

export async function deleteDeal(request: APIRequestContext, token: string | null, dealId: string | null): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
}

export async function readDealStatus(
  request: APIRequestContext,
  token: string,
  dealId: string,
): Promise<string | null> {
  const response = await apiRequest(request, 'GET', `/api/customers/deals/${dealId}`, { token });
  expect(response.status(), `GET deal ${dealId} should return 200`).toBe(200);
  const body = await readJsonSafe<{ deal?: { status?: string | null } }>(response);
  return body?.deal?.status ?? null;
}

export async function executeTool(
  request: APIRequestContext,
  token: string,
  toolName: string,
  args: Record<string, unknown>,
  correlationId?: string,
): Promise<APIResponse> {
  return apiRequest(request, 'POST', EXECUTE_PATH, {
    token,
    data: { toolName, args },
    headers: correlationId ? { [CORRELATION_ID_HEADER]: correlationId } : undefined,
  });
}

export async function queueDealStageChange(
  request: APIRequestContext,
  token: string,
  dealId: string,
): Promise<{ pendingActionId: string; body: PendingApprovalResponse }> {
  const response = await executeTool(request, token, DEAL_MUTATION_TOOL, {
    dealId,
    toStage: DEAL_TARGET_STATUS,
  });
  const body = await readJsonSafe<PendingApprovalResponse>(response);
  expect(response.status(), `approval mode should queue the write (body: ${JSON.stringify(body)})`).toBe(202);
  expect(typeof body?.pendingActionId).toBe('string');
  return { pendingActionId: body!.pendingActionId!, body: body! };
}

export async function readPendingAction(
  request: APIRequestContext,
  token: string,
  pendingActionId: string,
): Promise<{ status: number; body: PendingActionDetail | null }> {
  const response = await apiRequest(request, 'GET', `${ACTIONS_PATH}/${pendingActionId}`, { token });
  return { status: response.status(), body: await readJsonSafe<PendingActionDetail>(response) };
}

export async function loginAsScopedUser(page: Page, fixture: ScopedUserFixture): Promise<void> {
  const form = new URLSearchParams();
  form.set('email', fixture.email);
  form.set('password', FIXTURE_PASSWORD);
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  });
  expect(response.ok(), `fixture user login failed: ${response.status()}`).toBeTruthy();
  const { tenantId, organizationId } = getTokenScope(fixture.token);
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  await page.context().addCookies([
    { name: 'om_selected_tenant', value: tenantId, url: baseUrl, sameSite: 'Lax' },
    { name: 'om_selected_org', value: organizationId, url: baseUrl, sameSite: 'Lax' },
  ]);
}
