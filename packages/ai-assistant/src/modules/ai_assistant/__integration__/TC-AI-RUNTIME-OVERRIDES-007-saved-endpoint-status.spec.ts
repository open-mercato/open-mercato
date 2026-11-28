import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

test('TC-AI-RUNTIME-OVERRIDES-007: settings identifies blocked saved endpoints', async ({ page }) => {
  await login(page, 'superadmin')
  const blockedWarning = 'The saved AI endpoint is blocked by the allowlist. Update or clear the endpoint override.'
  const configuredProvider = {
    id: 'openai',
    name: 'OpenAI',
    model: 'openai/gpt-4o-mini',
    defaultModel: 'gpt-4o-mini',
    envKey: null,
    configured: false,
    defaultModels: [],
  }
  const modelResolution = {
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    source: 'provider_default',
  }
  const savedUrl = 'https://saved.example.test/v1'

  await page.route('**/api/ai_assistant/settings', (route) => route.fulfill({
    json: {
      provider: configuredProvider,
      availableProviders: [configuredProvider],
      mcpKeyConfigured: false,
      resolvedDefault: { ...modelResolution, baseURL: null, baseURLBlocked: true },
      tenantOverride: { providerId: null, modelId: null, baseURL: savedUrl, agentId: null, updatedAt: new Date().toISOString() },
      agents: [
        {
          ...modelResolution,
          agentId: 'example.blocked',
          moduleId: 'example',
          allowRuntimeOverride: true,
          override: { baseURL: savedUrl },
          baseURL: null,
          baseURLBlocked: true,
        },
        {
          ...modelResolution,
          agentId: 'example.fixed',
          moduleId: 'example',
          allowRuntimeOverride: false,
          override: null,
          baseURL: null,
        },
      ],
    },
  }))

  await page.goto('/backend/config/ai-assistant/settings')
  await expect(page.getByRole('alert').filter({ hasText: blockedWarning })).toBeVisible()
  await expect(page.locator('[data-ai-settings-override-form]').getByRole('button', { name: 'Clear override' })).toBeEnabled()
  const blockedAgent = page.getByRole('row', { name: /example\.blocked/ })
  await expect(blockedAgent.getByText(blockedWarning)).toBeVisible()
  await expect(blockedAgent.getByText('gpt-4o-mini')).toHaveCount(0)
  await expect(blockedAgent.getByRole('button', { name: 'Clear override' })).toBeEnabled()
  const fixedAgent = page.getByRole('row', { name: /example\.fixed/ })
  await expect(fixedAgent.getByText('gpt-4o-mini')).toBeVisible()
  await expect(fixedAgent.getByText(blockedWarning)).toHaveCount(0)
})
