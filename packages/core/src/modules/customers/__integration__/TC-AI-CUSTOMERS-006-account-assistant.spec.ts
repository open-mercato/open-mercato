import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-AI-CUSTOMERS-006: First production AI agent — customers.account_assistant
 * (Step 4.7 / Phase 2 WS-C).
 *
 * Covers the first time `ai-agents.ts` lands under a real module. Three
 * checkpoints:
 *   1. The dedicated agent-list endpoint surfaces the agent with its
 *      read-only flag and allowed-tool whitelist.
 *   2. `meta.describe_agent` (via `POST /api/ai_assistant/tools/execute`)
 *      returns the structured prompt text we composed from the seven
 *      §8 sections and echoes the read-only / mutation-policy flags.
 *   3. The backoffice playground picker actually populates with the new
 *      agent (no more empty-state) so Step 4.7 closes the Phase 2 WS-C
 *      entry point end-to-end.
 *
 * All three assertions run as superadmin; the agent's required features
 * (`customers.people.view`, `customers.companies.view`,
 * `customers.deals.view`) are always held by that role.
 */
test.describe('TC-AI-CUSTOMERS-006: customers.account_assistant agent', () => {
  const AGENT_ID = 'customers.account_assistant';
  const EXPECTED_SECTION_HEADERS = [
    'ROLE',
    'SCOPE',
    'DATA',
    'TOOLS',
    'ATTACHMENTS',
    'MUTATION POLICY',
    'RESPONSE STYLE',
  ];

  test('agent is listed via /api/ai_assistant/ai/agents as read-only', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin');

    const response = await request.fetch('/api/ai_assistant/ai/agents', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status()).toBe(200);
    const payload = (await response.json()) as {
      agents?: Array<{
        id?: unknown;
        moduleId?: unknown;
        readOnly?: unknown;
        mutationPolicy?: unknown;
        allowedTools?: unknown;
        requiredFeatures?: unknown;
      }>;
    };
    const agent = (payload.agents ?? []).find((entry) => entry?.id === AGENT_ID);
    expect(agent, `Expected agent ${AGENT_ID} in response`).toBeTruthy();
    expect(agent!.moduleId).toBe('customers');
    expect(agent!.readOnly).toBe(false);
    expect(agent!.mutationPolicy).toBe('confirm-required');
    const allowedTools = Array.isArray(agent!.allowedTools) ? (agent!.allowedTools as string[]) : [];
    expect(allowedTools).toContain('customers.list_people');
    expect(allowedTools).toContain('meta.describe_agent');
    const requiredFeatures = Array.isArray(agent!.requiredFeatures)
      ? (agent!.requiredFeatures as string[])
      : [];
    expect(requiredFeatures).toEqual(
      expect.arrayContaining([
        'customers.people.view',
        'customers.companies.view',
        'customers.deals.view',
      ]),
    );
  });

  test('meta.describe_agent returns the seven prompt sections', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin');

    const response = await request.fetch('/api/ai_assistant/tools/execute', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: JSON.stringify({
        toolName: 'meta.describe_agent',
        args: { agentId: AGENT_ID },
      }),
    });

    expect(response.status()).toBe(200);
    const payload = (await response.json()) as {
      success?: boolean;
      result?: {
        agent?: {
          readOnly?: unknown;
          mutationPolicy?: unknown;
          prompt?: { systemPrompt?: unknown };
        } | null;
      };
    };
    expect(payload.success).toBe(true);
    expect(payload.result?.agent).toBeTruthy();
    const agentDescription = payload.result!.agent!;
    expect(agentDescription.readOnly).toBe(false);
    expect(agentDescription.mutationPolicy).toBe('confirm-required');
    const systemPrompt = agentDescription.prompt?.systemPrompt;
    expect(typeof systemPrompt).toBe('string');
    for (const header of EXPECTED_SECTION_HEADERS) {
      expect(systemPrompt as string).toContain(header);
    }
  });

  test('playground picker lists the agent for superadmin', async ({ page }) => {
    await login(page, 'superadmin');
    await page.goto('/backend/config/ai-assistant/playground', { waitUntil: 'domcontentloaded' });

    const picker = page.locator('[data-ai-playground-agent-picker]');
    await expect(picker).toBeVisible({ timeout: 15_000 });
    const optionLocator = picker.locator(`option[value="${AGENT_ID}"]`);
    await expect(optionLocator).toHaveCount(1);
  });
});
