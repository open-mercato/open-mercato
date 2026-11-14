import { test, expect } from '@playwright/test';
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
 * TC-AI-MCP-AUDIT-014 — Direct tool calls leave an access-log audit row.
 * Source: spec `.ai/specs/2026-10-21-mcp-tool-exposure-parity-and-audit.md`.
 *
 * Surfaces under test:
 *   - /api/ai_assistant/tools/execute         (POST, `x-correlation-id` header)
 *   - /api/audit_logs/audit-logs/access        (GET, filtered by resource kind)
 *
 * After a `/tools/execute` call the caller's access-log listing contains a row
 * with resource kind `ai_assistant.mcp_tool_call`, the tool name as resource id,
 * the caller-supplied correlation id echoed in `context.correlationId`, and
 * only argument KEYS (`context.argKeys`) — never the argument values.
 */

type AccessLogItem = {
  resourceKind: string;
  resourceId: string;
  accessType: string;
  context: Record<string, unknown> | null;
};

test.describe('TC-AI-MCP-AUDIT-014: tool-call audit rows', () => {
  test('a /tools/execute call writes an audit row with the correlation id and no argument values', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const correlationId = `it-mcp-audit-${uniqueStamp()}`;
    const secretSearchValue = `it-secret-${uniqueStamp()}`;

    const execute = await executeTool(
      request,
      adminToken,
      DEAL_READ_TOOL,
      { q: secretSearchValue, limit: 1 },
      correlationId,
    );
    expect([200, 400], `unexpected execute status ${execute.status()}`).toContain(execute.status());

    let auditRow: AccessLogItem | undefined;
    await expect
      .poll(
        async () => {
          const response = await apiRequest(
            request,
            'GET',
            `${ACCESS_LOGS_PATH}?resourceKind=${encodeURIComponent(MCP_AUDIT_RESOURCE_KIND)}&pageSize=50`,
            { token: adminToken },
          );
          if (response.status() !== 200) return false;
          const body = await readJsonSafe<{ items?: AccessLogItem[] }>(response);
          auditRow = (body?.items ?? []).find((item) => item.context?.correlationId === correlationId);
          return Boolean(auditRow);
        },
        { timeout: 15_000, message: 'audit row with the request correlation id should be listed' },
      )
      .toBe(true);

    expect(auditRow!.resourceKind).toBe(MCP_AUDIT_RESOURCE_KIND);
    expect(auditRow!.resourceId).toBe(DEAL_READ_TOOL);
    expect(auditRow!.accessType).toBe('call');
    expect(auditRow!.context?.channel).toBe('tools-api');
    expect(auditRow!.context?.principal).toBe('session');
    expect(auditRow!.context?.isMutation).toBe(false);
    expect(auditRow!.context?.argKeys).toEqual(expect.arrayContaining(['q', 'limit']));
    expect(JSON.stringify(auditRow), 'argument values never reach the audit row').not.toContain(secretSearchValue);
  });
});
