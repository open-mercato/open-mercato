import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-AI-sharing-07: Owner message label in shared-conversation viewer mode
 *
 * Regression test for the bug where user-role messages in a shared
 * conversation always rendered as "You" for the viewer, even when they were
 * written by the conversation owner and had no senderUserId (common for
 * conversations imported from local storage).
 *
 * Root cause: `isOtherUsersMessage` included `&& message.senderUserId != null`,
 * but imported messages don't carry senderUserId. Since viewers can never send
 * messages (the composer is hidden), ALL user-role messages when isOwner===false
 * belong to the owner.
 *
 * Fix: removed the senderUserId guard from MessageRow in AiChat.tsx.
 *
 * Assertions:
 *   - [data-ai-chat-read-only-notice] is visible (confirms isOwner===false path)
 *   - user-role messages show "Owner" label, not "You" / "Ty"
 *   - assistant messages show "Assistant"
 *   - composer is hidden (read-only viewer mode)
 */
test.describe('TC-AI-sharing-07: viewer sees Owner label on owner messages', () => {
  const STUB_CONV_ID = 'test-shared-conv-02';
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

  // Conversation where isOwner===false (viewer). Messages have senderUserId:null
  // because they were imported from local storage — this was the triggering
  // condition of the bug.
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
      importedFromLocalAt: new Date().toISOString(),
      isOwner: false,
    },
    messages: [
      {
        id: 'msg-u1',
        clientMessageId: 'cmsg-u1',
        role: 'user',
        content: 'What are the open deals for Acme?',
        uiParts: [],
        attachmentIds: [],
        files: [],
        model: null,
        metadata: null,
        createdAt: new Date().toISOString(),
        // Deliberately null — imported messages never have senderUserId.
        senderUserId: null,
      },
      {
        id: 'msg-a1',
        clientMessageId: 'cmsg-a1',
        role: 'assistant',
        content: 'I found 3 open deals for Acme Corp.',
        uiParts: [],
        attachmentIds: [],
        files: [],
        model: 'claude-haiku-4-5',
        metadata: null,
        createdAt: new Date().toISOString(),
        senderUserId: null,
      },
    ],
    nextCursor: null,
  };

  test('viewer sees Owner/Assistant labels and read-only notice', async ({ page }) => {
    await login(page, 'superadmin');

    await page.route('**/api/ai_assistant/health', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ healthy: true }) }),
    );
    await page.route('**/api/ai_assistant/ai/agents', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(agentsStub) }),
    );
    await page.route(`**/api/ai_assistant/ai/conversations/${STUB_CONV_ID}**`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(conversationStub) }),
    );

    await page.goto(`/backend?openAiConversation=${STUB_CONV_ID}`, { waitUntil: 'domcontentloaded' });

    const sheet = page.locator('[data-ai-launcher-sheet]');
    await expect(sheet).toBeVisible({ timeout: 10_000 });

    // Read-only notice must be present for a viewer.
    await expect(sheet.locator('[data-ai-chat-read-only-notice]')).toBeVisible();

    // User-role messages (from owner, senderUserId=null) must show "Owner", not "You".
    const userMessages = sheet.locator('[data-role="user"]');
    await expect(userMessages.first()).toBeVisible();
    // The label is the first text-xs div inside the message header.
    const userLabel = userMessages.first().locator('div.text-xs').first();
    await expect(userLabel).toHaveText(/owner/i);
    // Regression guard: must NOT show "You" or "Ty".
    await expect(userLabel).not.toHaveText(/^you$/i);

    // Assistant messages must still show "Assistant".
    const assistantMessages = sheet.locator('[data-role="assistant"]');
    await expect(assistantMessages.first()).toBeVisible();
    const assistantLabel = assistantMessages.first().locator('div.text-xs').first();
    await expect(assistantLabel).toHaveText(/assistant/i);
  });

  test('viewer composer is hidden (cannot send messages)', async ({ page }) => {
    await login(page, 'superadmin');

    await page.route('**/api/ai_assistant/health', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ healthy: true }) }),
    );
    await page.route('**/api/ai_assistant/ai/agents', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(agentsStub) }),
    );
    await page.route(`**/api/ai_assistant/ai/conversations/${STUB_CONV_ID}**`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(conversationStub) }),
    );

    await page.goto(`/backend?openAiConversation=${STUB_CONV_ID}`, { waitUntil: 'domcontentloaded' });

    const sheet = page.locator('[data-ai-launcher-sheet]');
    await expect(sheet).toBeVisible({ timeout: 10_000 });

    // The composer form is hidden via className when isOwner===false.
    // It should not be visible to the user.
    const composer = sheet.locator('form[data-ai-chat-composer], [data-ai-chat-composer]');
    // Either not present or hidden.
    const isComposerVisible = await composer.isVisible().catch(() => false);
    expect(isComposerVisible).toBe(false);
  });
});
