import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  ACCESS_LOGS_PATH,
  MCP_AUDIT_RESOURCE_KIND,
  TOOLS_PATH,
  createScopedUser,
  deleteScopedUser,
  executeTool,
  uniqueStamp,
  type ScopedUserFixture,
} from './helpers/mcpFixtures';

/**
 * TC-AI-MCP-RATE-LIMIT-018 — Agent tools are rate-limited per caller (roadmap-gaps C-3).
 * Source: spec `.ai/specs/2026-10-21-mcp-tool-exposure-parity-and-audit.md` (risk "Agent tool cost/latency abuse").
 *
 * Surfaces under test:
 *   - /api/ai_assistant/tools/execute         (POST, agent tool over the per-caller ceiling)
 *   - /api/audit_logs/audit-logs/access        (GET `actorScope=all` as admin, the refused call's audit row)
 *
 * The ceiling is `RATE_LIMIT_AI_AGENT_TOOL_POINTS` (default 30) calls per window, per tenant and
 * session user. Rate limits are globally off in the integration environment unless the app was
 * started with `OM_TEST_RATE_LIMIT_MODE=enabled`; run this spec with that and a small ceiling, e.g.
 * `OM_TEST_RATE_LIMIT_MODE=enabled RATE_LIMIT_AI_AGENT_TOOL_POINTS=1`. The call that exceeds the
 * ceiling is refused before the agent starts, so no model provider is needed for the assertion.
 *
 * Fixtures: two fresh users (fresh buckets), removed in `finally`.
 */

const AGENT_TOOL = 'agent_examples.triage_ticket';
const AGENT_TOOL_ARGS = { subject: 'Printer offline', body: 'The office printer stopped responding this morning.' };
const TOOL_FEATURES = ['ai_assistant.view', 'agent_orchestrator.agents.view'];
const MAX_POINTS_FOR_SPEC = 3;

type ExposureTool = { name?: unknown; exposed?: unknown; agentRef?: unknown };
type AccessLogItem = { resourceId: string; context: Record<string, unknown> | null };

async function isAgentToolExposed(request: APIRequestContext, token: string): Promise<boolean> {
  const response = await apiRequest(request, 'GET', `${TOOLS_PATH}?view=mcp`, { token });
  if (response.status() !== 200) return false;
  const body = await readJsonSafe<{ tools?: ExposureTool[] }>(response);
  return (body?.tools ?? []).some((tool) => tool.name === AGENT_TOOL && tool.exposed === true && Boolean(tool.agentRef));
}

test.describe('TC-AI-MCP-RATE-LIMIT-018: agent tool rate limit', () => {
  test('an agent tool call over the per-user ceiling gets 429 + Retry-After and an audited denial; other users keep their own bucket', async ({ request }) => {
    test.slow();
    const points = Number(process.env.RATE_LIMIT_AI_AGENT_TOOL_POINTS ?? 30);
    test.skip(
      process.env.OM_TEST_RATE_LIMIT_MODE !== 'enabled',
      'rate limits are disabled in this environment (start the app with OM_TEST_RATE_LIMIT_MODE=enabled)',
    );
    test.skip(
      !Number.isInteger(points) || points < 1 || points > MAX_POINTS_FOR_SPEC,
      `set RATE_LIMIT_AI_AGENT_TOOL_POINTS between 1 and ${MAX_POINTS_FOR_SPEC} so the spec does not start many agent runs`,
    );

    const adminToken = await getAuthToken(request, 'admin');
    test.skip(!(await isAgentToolExposed(request, adminToken)), `${AGENT_TOOL} is not registered in this app`);

    let limitedUser: ScopedUserFixture | null = null;
    let otherUser: ScopedUserFixture | null = null;
    try {
      limitedUser = await createScopedUser(request, adminToken, { label: 'rl-limited', features: TOOL_FEATURES });
      otherUser = await createScopedUser(request, adminToken, { label: 'rl-other', features: TOOL_FEATURES });

      for (let call = 1; call <= points; call += 1) {
        const allowed = await executeTool(request, limitedUser.token, AGENT_TOOL, AGENT_TOOL_ARGS);
        expect([429, 503], `call ${call} of ${points} must not be throttled`).not.toContain(allowed.status());
      }

      const correlationId = `it-mcp-rl-${uniqueStamp()}`;
      const refused = await executeTool(request, limitedUser.token, AGENT_TOOL, AGENT_TOOL_ARGS, correlationId);
      expect(refused.status(), 'the call over the ceiling is refused').toBe(429);
      expect(Number(refused.headers()['retry-after'])).toBeGreaterThan(0);
      const refusedBody = await readJsonSafe<{ success?: boolean; code?: string }>(refused);
      expect(refusedBody).toMatchObject({ success: false, code: 'RATE_LIMITED' });

      const otherCall = await executeTool(request, otherUser.token, AGENT_TOOL, AGENT_TOOL_ARGS);
      expect([429, 503], 'another user has a separate bucket').not.toContain(otherCall.status());

      let auditRow: AccessLogItem | undefined;
      await expect
        .poll(
          async () => {
            const response = await apiRequest(
              request,
              'GET',
              `${ACCESS_LOGS_PATH}?resourceKind=${encodeURIComponent(MCP_AUDIT_RESOURCE_KIND)}&pageSize=100&actorScope=all`,
              { token: adminToken },
            );
            if (response.status() !== 200) return false;
            const body = await readJsonSafe<{ items?: AccessLogItem[] }>(response);
            auditRow = (body?.items ?? []).find((item) => item.context?.correlationId === correlationId);
            return Boolean(auditRow);
          },
          { timeout: 15_000, message: 'the refused call should leave an audit row' },
        )
        .toBe(true);
      expect(auditRow!.resourceId).toBe(AGENT_TOOL);
      expect(auditRow!.context).toMatchObject({ channel: 'tools-api', outcome: 'denied', errorCode: 'RATE_LIMITED' });
    } finally {
      await deleteScopedUser(request, adminToken, limitedUser);
      await deleteScopedUser(request, adminToken, otherUser);
    }
  });
});
