import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { localizeProviderAvailability } from '../lib/provider-diagnostics'
import pl from '../i18n/pl.json' with { type: 'json' }

export const integrationMeta = { dependsOnModules: ['search', 'auth'] }

test('TC-SEARCH-015: Polish settings show environment hints and isolated unavailable-provider diagnostics', async ({ page, request, baseURL }) => {
  test.setTimeout(120_000)
  const token = await getAuthToken(request, 'admin')
  const { organizationId } = getTokenContext(token)
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const email = `search-diagnostics-${stamp}@example.com`
  const password = `Search-015-${stamp}!`
  let roleId: string | null = null
  let userId: string | null = null
  const translate = createTranslator(pl)
  const missingKey = localizeProviderAvailability({
    providerId: 'openai', available: false, reason: 'Set OPENAI_API_KEY to enable OpenAI',
    diagnostic: { key: 'missingKey', params: { envKey: 'OPENAI_API_KEY', provider: 'OpenAI' } },
  }, translate)
  const unreachable = localizeProviderAvailability({
    providerId: 'ollama', available: false, reason: 'Ollama not reachable',
    diagnostic: { key: 'ollamaTimeout', params: { baseUrl: 'http://ollama.test:11434' } },
  }, translate)
  try {
    roleId = await createRoleFixture(request, token, { name: `search-diagnostics-${stamp}` })
    await setRoleAclFeatures(request, token, { roleId, features: ['search.view', 'search.embeddings.view'] })
    userId = await createUserFixture(request, token, { email, password, organizationId, roles: [roleId] })
    const login = await page.request.post('/api/auth/login', { form: { email, password } })
    expect(login.ok()).toBeTruthy()
    await acknowledgeGlobalNotices(page)
    await page.context().addCookies([{ name: 'locale', value: 'pl', url: baseURL ?? 'http://localhost:3000' }])
    await page.route('**/api/search/embeddings', async (route) => {
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      const body = await response.json()
      await route.fulfill({ response, json: {
        ...body,
        settings: { ...body.settings, embeddingConfig: null, configuredProviders: [], providerAvailability: [missingKey, unreachable] },
      } })
    })
    await page.goto('/backend/config/search')
    for (const key of ['host', 'apiKey', 'indexPrefix', 'excludeEncrypted']) {
      await expect(page.getByText(translate(`search.settings.fulltext.hints.${key}`), { exact: true })).toBeVisible()
    }
    await expect(page.getByText(missingKey.reason!, { exact: true })).toBeVisible()
    await expect(page.getByText(unreachable.reason!, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /OpenAI/ })).toBeDisabled()
    await expect(page.getByRole('button', { name: /Ollama/ })).toBeDisabled()
    await expect(page.locator('body')).not.toContainText(/The URL of your|API key for authentication|Set OPENAI_API_KEY|Ollama not reachable|search\.settings\.(fulltext\.hints|providers\.diagnostics)/)
  } finally {
    await page.unroute('**/api/search/embeddings')
    await page.context().clearCookies()
    await deleteUserIfExists(request, token, userId)
    await deleteRoleIfExists(request, token, roleId)
  }
})
