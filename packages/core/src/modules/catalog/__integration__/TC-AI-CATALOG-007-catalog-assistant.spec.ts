import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-AI-CATALOG-007: First catalog AI agent — catalog.catalog_assistant
 * (Step 4.8 / Phase 2 WS-C).
 *
 * Mirrors TC-AI-CUSTOMERS-006 (Step 4.7). Three checkpoints:
 *   1. The dedicated agent-list endpoint surfaces the catalog agent
 *      with its read-only flag and allowed-tool whitelist (base catalog
 *      pack only — no D18 merchandising tool leaks in).
 *   2. `meta.describe_agent` (via `POST /api/ai_assistant/tools/execute`)
 *      returns the structured prompt composed from the seven §8 sections
 *      and echoes the read-only / mutation-policy flags.
 *   3. The backoffice playground picker at
 *      `/backend/config/ai-assistant/playground` lists BOTH the existing
 *      `customers.account_assistant` (Step 4.7) and the new
 *      `catalog.catalog_assistant` entries.
 */
test.describe('TC-AI-CATALOG-007: catalog.catalog_assistant agent', () => {
  const CATALOG_AGENT_ID = 'catalog.catalog_assistant';
  const CUSTOMERS_AGENT_ID = 'customers.account_assistant';
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
    const agent = (payload.agents ?? []).find((entry) => entry?.id === CATALOG_AGENT_ID);
    expect(agent, `Expected agent ${CATALOG_AGENT_ID} in response`).toBeTruthy();
    expect(agent!.moduleId).toBe('catalog');
    expect(agent!.readOnly).toBe(true);
    expect(agent!.mutationPolicy).toBe('read-only');
    const allowedTools = Array.isArray(agent!.allowedTools) ? (agent!.allowedTools as string[]) : [];
    expect(allowedTools).toContain('catalog.list_products');
    expect(allowedTools).toContain('catalog.list_categories');
    expect(allowedTools).toContain('meta.describe_agent');
    // Deny-list: D18 merchandising tools belong to the Step 4.9 agent.
    expect(allowedTools).not.toContain('catalog.search_products');
    expect(allowedTools).not.toContain('catalog.draft_description_from_attributes');
    const requiredFeatures = Array.isArray(agent!.requiredFeatures)
      ? (agent!.requiredFeatures as string[])
      : [];
    expect(requiredFeatures).toEqual(
      expect.arrayContaining(['catalog.products.view', 'catalog.categories.view']),
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
        args: { agentId: CATALOG_AGENT_ID },
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
    expect(agentDescription.readOnly).toBe(true);
    expect(agentDescription.mutationPolicy).toBe('read-only');
    const systemPrompt = agentDescription.prompt?.systemPrompt;
    expect(typeof systemPrompt).toBe('string');
    for (const header of EXPECTED_SECTION_HEADERS) {
      expect(systemPrompt as string).toContain(header);
    }
  });

  test('playground picker lists both the customers and catalog agents for superadmin', async ({ page }) => {
    await login(page, 'superadmin');
    await page.goto('/backend/config/ai-assistant/playground', { waitUntil: 'domcontentloaded' });

    const picker = page.locator('[data-ai-playground-agent-picker]');
    await expect(picker).toBeVisible({ timeout: 15_000 });
    await expect(picker.locator(`option[value="${CATALOG_AGENT_ID}"]`)).toHaveCount(1);
    await expect(picker.locator(`option[value="${CUSTOMERS_AGENT_ID}"]`)).toHaveCount(1);
  });
});
