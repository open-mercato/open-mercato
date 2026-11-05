import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-AI-sharing-06: Deep-link auto-open via ?openAiConversation=<id>
 *
 * Regression test for the bug where navigating to
 * `/backend?openAiConversation=<id>` failed to open the AiAssistantLauncher
 * chat sheet — because the launcher read window.location.search only on mount
 * and AppShell never remounts during client-side navigation.
 *
 * Fix: replaced mount-only useEffect with useSearchParams() from next/navigation,
 * which is reactive to URL changes in both hard and client-side navigations.
 *
 * Also verifies the URL-cleanup behaviour: after the deep-link is handled the
 * launcher strips ?openAiConversation from the URL via router.replace() so
 * subsequent normal chat opens don't inherit the shared conversation.
 *
 * API routes are fully stubbed — no live LLM is called.
 */
test.describe('TC-AI-sharing-06: deep-link auto-open from ?openAiConversation', () => {
  const STUB_CONV_ID = 'test-shared-conv-01';
  const STUB_AGENT_ID = 'customers.account_assistant';

  const agentsStub = {
    agents: [
      {
        id: STUB_AGENT_ID,
        moduleId: 'customers',
        label: 'Account assistant',
        description: 'Helps with customer accounts.',
        executionMode: 'chat',
        mutationPolicy: 'read-only',
        allowedTools: [],
        requiredFeatures: [],
        acceptedMediaTypes: [],
        hasOutputSchema: false,
      },
    ],
    total: 1,
    aiConfigured: true,
  };

  const conversationStub = {
    conversation: {
      conversationId: STUB_CONV_ID,
      agentId: STUB_AGENT_ID,
      title: 'Shared conversation',
      status: 'open',
      visibility: 'shared',
      pageContext: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastMessageAt: null,
      importedFromLocalAt: null,
      isOwner: false,
    },
    messages: [],
    nextCursor: null,
  };

  async function setupStubs(page: import('@playwright/test').Page) {
    await page.route('**/api/ai_assistant/health', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ healthy: true }) }),
    );
    await page.route('**/api/ai_assistant/ai/agents', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(agentsStub) }),
    );
    await page.route(`**/api/ai_assistant/ai/conversations/${STUB_CONV_ID}**`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(conversationStub) }),
    );
  }

  test('chat sheet opens when page loads with ?openAiConversation param', async ({ page }) => {
    await login(page, 'superadmin');
    await setupStubs(page);

    await page.goto(`/backend?openAiConversation=${STUB_CONV_ID}`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('[data-ai-launcher-sheet]')).toBeVisible({ timeout: 10_000 });
  });

  test('URL param is stripped after deep-link is handled', async ({ page }) => {
    await login(page, 'superadmin');
    await setupStubs(page);

    await page.goto(`/backend?openAiConversation=${STUB_CONV_ID}`, { waitUntil: 'domcontentloaded' });

    // Wait for the chat to open (deep-link was handled).
    await expect(page.locator('[data-ai-launcher-sheet]')).toBeVisible({ timeout: 10_000 });

    // The launcher calls router.replace(pathname) after opening, stripping the
    // param. The URL should no longer contain openAiConversation.
    await expect(page).not.toHaveURL(/openAiConversation/, { timeout: 5_000 });
  });

  test('deep-link is ignored when conversation fetch returns 403', async ({ page }) => {
    await login(page, 'superadmin');

    await page.route('**/api/ai_assistant/health', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ healthy: true }) }),
    );
    await page.route('**/api/ai_assistant/ai/agents', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(agentsStub) }),
    );
    // Simulate conversation that the viewer has no access to.
    await page.route(`**/api/ai_assistant/ai/conversations/${STUB_CONV_ID}**`, (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) }),
    );

    await page.goto(`/backend?openAiConversation=${STUB_CONV_ID}`, { waitUntil: 'domcontentloaded' });

    // Launcher should be visible but chat sheet must NOT auto-open.
    await expect(page.locator('[data-ai-launcher-trigger]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-ai-launcher-sheet]')).not.toBeVisible();
  });
});
