import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'

/**
 * TC-CAT-043: changing a code block's language or deleting a code block in
 * the markdown editor is saved without the user needing to type anything
 * else first (QA NO-GO on PR #7036 / #6997, repro steps from @droalina,
 * tracked as issue #7469).
 *
 * Root cause: the language-select and delete controls apply their change
 * through a Lexical editor update that resolves after DOM focus has already
 * left the editor, so the `blur` that normally flushes a pending edit into
 * the CrudForm field found nothing pending yet, and no later blur ever
 * arrived to retry it — see MdxEditorImpl.tsx.
 */

async function readProductDescription(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<string> {
  const response = await apiRequest(request, 'GET', `/api/catalog/products?id=${encodeURIComponent(id)}&page=1&pageSize=1`, {
    token,
  })
  expect(response.status(), `product read-back failed: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  const item = (body?.items ?? []).find((entry) => entry.id === id) ?? null
  expect(item, `product ${id} should be present in the list read-back`).toBeTruthy()
  return String((item as Record<string, unknown>).description ?? '')
}

test.describe('TC-CAT-043: markdown code block edits are saved', () => {
  test('changing a code block language from the dropdown is saved without typing afterward', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    const token = await getAuthToken(request, 'admin')
    let productId: string | null = null

    try {
      const description = [
        'Intro line with enough words to pass the product SEO length check.',
        '',
        '```text',
        `Tagged block ${stamp}`,
        '```',
      ].join('\n')

      const response = await apiRequest(request, 'POST', '/api/catalog/products', {
        token,
        data: {
          title: `QA CAT-043 lang ${stamp}`,
          sku: `qa-cat-043-lang-${stamp}`,
          description,
          metadata: { __useMarkdown: true },
        },
      })
      expect(response.ok(), `Failed to create product: ${response.status()}`).toBeTruthy()
      const payload = (await readJsonSafe(response)) as { id?: unknown }
      productId = typeof payload.id === 'string' ? payload.id : null
      expect(productId, 'No id in product create response').toBeTruthy()

      await login(page, 'admin')
      await page.goto(`/backend/catalog/products/${encodeURIComponent(productId as string)}`, {
        waitUntil: 'domcontentloaded',
      })

      const editor = page.locator('.om-mdx-prose')
      await expect(editor).toBeVisible({ timeout: 15_000 })
      await expect(editor.getByText(`Tagged block ${stamp}`)).toBeVisible()

      const languageSelect = page.getByRole('combobox', { name: /language/i }).first()
      await expect(languageSelect).toBeVisible()
      await languageSelect.click()
      await page.getByRole('option', { name: 'JSON' }).click()
      await expect(languageSelect).toHaveText('JSON')

      const putPromise = page.waitForResponse(
        (res) => res.request().method() === 'PUT' && res.url().includes('/api/catalog/products'),
        { timeout: 15_000 },
      )
      await page.getByRole('button', { name: /^save changes$/i }).first().click()
      const saveResponse = await putPromise
      expect(saveResponse.status(), 'save should succeed').toBeLessThan(400)

      await page.goto(`/backend/catalog/products/${encodeURIComponent(productId as string)}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(page.locator('.om-mdx-prose')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('combobox', { name: /language/i }).first()).toHaveText('JSON')

      const persistedDescription = await readProductDescription(request, token, productId as string)
      expect(persistedDescription).toContain('```json')
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('deleting a code block with the trash icon is saved without typing afterward', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    const token = await getAuthToken(request, 'admin')
    let productId: string | null = null

    try {
      const description = [
        'Intro line with enough words to pass the product SEO length check.',
        '',
        '```text',
        `Keep this block ${stamp}`,
        '```',
        '',
        '```text',
        `Delete this block ${stamp}`,
        '```',
      ].join('\n')

      const response = await apiRequest(request, 'POST', '/api/catalog/products', {
        token,
        data: {
          title: `QA CAT-043 del ${stamp}`,
          sku: `qa-cat-043-del-${stamp}`,
          description,
          metadata: { __useMarkdown: true },
        },
      })
      expect(response.ok(), `Failed to create product: ${response.status()}`).toBeTruthy()
      const payload = (await readJsonSafe(response)) as { id?: unknown }
      productId = typeof payload.id === 'string' ? payload.id : null
      expect(productId, 'No id in product create response').toBeTruthy()

      await login(page, 'admin')
      await page.goto(`/backend/catalog/products/${encodeURIComponent(productId as string)}`, {
        waitUntil: 'domcontentloaded',
      })

      const editor = page.locator('.om-mdx-prose')
      await expect(editor).toBeVisible({ timeout: 15_000 })
      await expect(editor.getByText(`Keep this block ${stamp}`)).toBeVisible()
      await expect(editor.getByText(`Delete this block ${stamp}`)).toBeVisible()

      await page.getByTitle('Delete code block').last().click()
      await expect(editor.getByText(`Delete this block ${stamp}`)).toHaveCount(0)
      await expect(editor.getByText(`Keep this block ${stamp}`)).toBeVisible()

      const putPromise = page.waitForResponse(
        (res) => res.request().method() === 'PUT' && res.url().includes('/api/catalog/products'),
        { timeout: 15_000 },
      )
      await page.getByRole('button', { name: /^save changes$/i }).first().click()
      const saveResponse = await putPromise
      expect(saveResponse.status(), 'save should succeed').toBeLessThan(400)

      await page.goto(`/backend/catalog/products/${encodeURIComponent(productId as string)}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(page.locator('.om-mdx-prose')).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('.om-mdx-prose').getByText(`Delete this block ${stamp}`)).toHaveCount(0)
      await expect(page.locator('.om-mdx-prose').getByText(`Keep this block ${stamp}`)).toBeVisible()

      const persistedDescription = await readProductDescription(request, token, productId as string)
      expect(persistedDescription).not.toContain(`Delete this block ${stamp}`)
      expect(persistedDescription).toContain(`Keep this block ${stamp}`)
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
