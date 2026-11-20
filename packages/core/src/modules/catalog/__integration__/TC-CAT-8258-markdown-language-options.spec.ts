import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'

test.describe('TC-CAT-8258: custom Markdown language options', () => {
  test('adds, renames and hides choices through UMES while preserving existing tags', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null

    try {
      const description = [
        'Product description with enough context for the product SEO check.', '',
        '```js', `custom choice ${stamp}`, '```', '',
        '```sql', `hidden language ${stamp}`, '```', '',
        '```unlisted title="sample.txt"', `unknown language ${stamp}`, '```',
      ].join('\n')
      const created = await apiRequest(request, 'POST', '/api/catalog/products', {
        token,
        data: { title: `QA language options ${stamp}`, sku: `qa-lang-${stamp}`, description, metadata: { __useMarkdown: false } },
      })
      expect(created.ok()).toBeTruthy()
      const payload = await readJsonSafe<{ id?: string }>(created)
      productId = payload?.id ?? null
      expect(productId).toBeTruthy()
      const productUrl = `/backend/catalog/products/${encodeURIComponent(productId!)}`
      await login(page, 'admin')
      await page.goto(productUrl)
      const toggle = page.getByRole('button', { name: /^use markdown$/i })
      await expect(toggle).toBeVisible()
      await page.waitForFunction(() => '__openMercatoComponentRegistry__' in globalThis)
      await page.evaluate(() => {
        type EditorProps = { codeBlockLanguages?: Record<string, string | null> }
        type Override = {
          target: { componentId: string }; priority: number;
          propsTransform: (props: EditorProps) => EditorProps
        }
        const registry = (globalThis as typeof globalThis & {
          __openMercatoComponentRegistry__?: { overrides: Override[] }
        }).__openMercatoComponentRegistry__
        if (!registry || !Array.isArray(registry.overrides)) throw new Error('[internal] UMES registry unavailable')
        const languageOverride: Override = {
          target: { componentId: 'section:ui.inputs.MarkdownField' }, priority: 100,
          propsTransform: (props) => ({ ...props, codeBlockLanguages: {
            ...props.codeBlockLanguages, rust: 'Rust', php: 'PHP', js: 'ECMAScript', sql: null,
          } }),
        }
        let configuredOverrides = [...registry.overrides, languageOverride]
        Object.defineProperty(registry, 'overrides', {
          configurable: true,
          get: () => configuredOverrides,
          set: (entries: Override[]) => {
            configuredOverrides = [...entries.filter((entry) => entry !== languageOverride), languageOverride]
          },
        })
      })
      await toggle.click()
      const languages = page.getByRole('combobox', { name: /language/i })
      await expect(languages).toHaveCount(3)
      await expect(languages.nth(0)).toHaveText('ECMAScript')
      await expect(languages.nth(1)).toHaveText('sql')
      await expect(languages.nth(2)).toHaveText('unlisted')
      await languages.first().click()
      await expect(page.getByRole('option', { name: 'Plain text', exact: true })).toBeVisible()
      await expect(page.getByRole('option', { name: 'PHP', exact: true })).toBeVisible()
      await expect(page.getByRole('option', { name: 'SQL', exact: true })).toHaveCount(0)
      await expect(page.getByRole('option', { name: 'JavaScript', exact: true })).toHaveCount(0)
      await page.getByRole('option', { name: 'Rust', exact: true }).click()
      await expect(languages.first()).toHaveText('Rust')
      const saved = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().includes('/api/catalog/products'))
      await page.getByRole('button', { name: /^save changes$/i }).first().click()
      expect((await saved).ok()).toBeTruthy()
      const readBack = await apiRequest(request, 'GET', `/api/catalog/products?id=${encodeURIComponent(productId!)}&pageSize=1`, { token })
      expect(readBack.ok()).toBeTruthy()
      const products = await readJsonSafe<{ items?: Array<{ id: string; description?: string }> }>(readBack)
      const persisted = products?.items?.find((product) => product.id === productId)?.description
      expect(persisted).toContain('```rust')
      expect(persisted).toContain('```sql')
      expect(persisted).toContain('```unlisted title="sample.txt"')
      expect(persisted).toContain(`unknown language ${stamp}`)
      await page.goto(productUrl)
      await expect(page.getByRole('combobox', { name: /language/i }).first()).toHaveText('rust')
      await expect(page.getByText(`unknown language ${stamp}`, { exact: true })).toBeVisible()
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
