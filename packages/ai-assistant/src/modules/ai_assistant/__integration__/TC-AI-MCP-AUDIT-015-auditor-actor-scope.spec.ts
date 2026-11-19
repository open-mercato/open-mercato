import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  ACCESS_LOGS_PATH,
  DEAL_READ_TOOL,
  MCP_AUDIT_RESOURCE_KIND,
  executeTool,
  uniqueStamp,
} from './helpers/mcpFixtures';

/**
 * TC-AI-MCP-AUDIT-015 — A tenant auditor can review other users' MCP calls.
 * Source: PR #9648 roadmap gap B-1.
 *
 * Surfaces under test:
 *   - /api/ai_assistant/tools/execute   (POST, `x-correlation-id` header)
 *   - /api/audit_logs/audit-logs/access (GET, `actorScope=all`)
 *
 * The default listing stays caller-only. `actorScope=all` widens it to every actor for a
 * caller holding `audit_logs.view_tenant` (admin) and is ignored for everyone else (employee).
 */

type AccessLogItem = {
  actorUserId: string | null;
  context: Record<string, unknown> | null;
};

async function findByCorrelation(
  request: APIRequestContext,
  token: string,
  query: string,
  correlationId: string,
): Promise<AccessLogItem | undefined> {
  const response = await apiRequest(
    request,
    'GET',
    `${ACCESS_LOGS_PATH}?resourceKind=${encodeURIComponent(MCP_AUDIT_RESOURCE_KIND)}&pageSize=100${query}`,
    { token },
  );
  expect(response.status(), 'access log listing should return 200').toBe(200);
  const body = await readJsonSafe<{ items?: AccessLogItem[] }>(response);
  return (body?.items ?? []).find((item) => item.context?.correlationId === correlationId);
}

test.describe('TC-AI-MCP-AUDIT-015: auditor actor scope on MCP audit rows', () => {
  test('admin sees an employee MCP call only with actorScope=all; employee cannot widen', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const employeeToken = await getAuthToken(request, 'employee');
    const employeeCorrelation = `it-mcp-scope-emp-${uniqueStamp()}`;
    const adminCorrelation = `it-mcp-scope-adm-${uniqueStamp()}`;

    const employeeCall = await executeTool(request, employeeToken, DEAL_READ_TOOL, { limit: 1 }, employeeCorrelation);
    expect([200, 400], `unexpected employee execute status ${employeeCall.status()}`).toContain(employeeCall.status());
    const adminCall = await executeTool(request, adminToken, DEAL_READ_TOOL, { limit: 1 }, adminCorrelation);
    expect([200, 400], `unexpected admin execute status ${adminCall.status()}`).toContain(adminCall.status());

    await expect
      .poll(async () => Boolean(await findByCorrelation(request, adminToken, '&actorScope=all', employeeCorrelation)), {
        timeout: 15_000,
        message: 'admin with actorScope=all should list the employee MCP call',
      })
      .toBe(true);

    expect(
      await findByCorrelation(request, adminToken, '', employeeCorrelation),
      'the default listing stays caller-only',
    ).toBeUndefined();

    await expect
      .poll(async () => Boolean(await findByCorrelation(request, employeeToken, '', employeeCorrelation)), {
        timeout: 15_000,
        message: 'employee should see their own MCP call',
      })
      .toBe(true);

    expect(
      await findByCorrelation(request, employeeToken, '&actorScope=all', adminCorrelation),
      'actorScope=all must not widen visibility without audit_logs.view_tenant',
    ).toBeUndefined();
  });
});
