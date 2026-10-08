import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'

test.describe('TC-CAT-038: Markdown editor opens content with code blocks', () => {
  test('product description with fenced and tagged code blocks loads in rich-text mode', async ({ page, request }) => {
    const stamp = Date.now()
    const token = await getAuthToken(request, 'admin')
    let productId: string | null = null

    try {
      const description = [
        'Proposed reply:',
        '',
        '```',
        `Hello QA ${stamp},`,
        'thank you for the brief.',
        '```',
        '',
        '```text',
        `Tagged block ${stamp}`,
        '```',
      ].join('\n')

      const response = await apiRequest(request, 'POST', '/api/catalog/products', {
        token,
        data: {
          title: `QA Markdown Code Block ${stamp}`,
          sku: `qa-md-code-${stamp}`,
          description,
          metadata: { __useMarkdown: true },
        },
      })
      expect(response.ok(), `Failed to create product: ${response.status()}`).toBeTruthy()
      const payload = (await readJsonSafe(response)) as { id?: unknown }
      productId = typeof payload.id === 'string' ? payload.id : null
      expect(productId, 'No id in product create response').toBeTruthy()

      await login(page, 'admin')
      await page.goto(`/backend/catalog/products/${encodeURIComponent(productId as string)}`)

      const editor = page.locator('.om-mdx-editor')
      await expect(editor).toBeVisible()
      await expect(editor.getByText(`Hello QA ${stamp},`)).toBeVisible()
      await expect(editor.getByText(`Tagged block ${stamp}`)).toBeVisible()
      await expect(page.getByText('Parsing of the following markdown structure failed')).toHaveCount(0)
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
