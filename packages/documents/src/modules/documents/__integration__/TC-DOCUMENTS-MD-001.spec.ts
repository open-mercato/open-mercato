import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type APIRequestContext, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = { dependsOnModules: ['documents'] }

async function deleteDocumentIfExists(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  if (!token || !id) return
  const detail = await apiRequest(request, 'GET', `/api/documents/${encodeURIComponent(id)}`, { token }).catch(() => null)
  const body = detail ? await readJsonSafe<{ updatedAt?: string }>(detail) : null
  await request.fetch(`/api/documents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, ...(body?.updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: body.updatedAt } : {}) },
  }).catch(() => undefined)
}

test.describe('TC-DOCUMENTS-MD-001: Import a Markdown file as a structured document', () => {
  test('creates a document with H1/H2 headings, a table and outline entries from a .md file', async ({ page, request }) => {
    test.setTimeout(120_000)
    const stamp = Date.now()
    const title = `TC-DOCUMENTS-MD-001 Supply Agreement ${stamp}`
    const markdown = [
      `# ${title}`,
      '',
      'This agreement is made between **Alpha Ltd** and *Beta GmbH*.',
      '',
      '## Definitions',
      '',
      '- Goods',
      '- Services',
      '',
      '## Payment Terms',
      '',
      '| Milestone | Share |',
      '| --- | --- |',
      '| Signing | 30% |',
      '',
      '<script>window.__mdInjected = true</script>',
    ].join('\n')
    const tempDir = await mkdtemp(join(tmpdir(), 'om-md-import-'))
    const filePath = join(tempDir, 'supply-agreement.md')
    await writeFile(filePath, markdown, 'utf8')
    let token: string | null = null
    let documentId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      await login(page, 'admin')
      await page.goto('/backend/documents', { waitUntil: 'domcontentloaded' })

      const importButton = page.getByRole('button', { name: 'Import Markdown' })
      await expect(importButton).toBeVisible({ timeout: 30_000 })
      const chooserPromise = page.waitForEvent('filechooser')
      await importButton.click()
      const chooser = await chooserPromise
      expect(chooser.isMultiple()).toBe(true)
      await chooser.setFiles(filePath)

      await page.waitForURL(/\/backend\/documents\/[0-9a-f-]{36}$/, { timeout: 30_000 })
      documentId = page.url().split('/').pop() ?? null

      const editor = page.locator('.ProseMirror:visible').first()
      await expect(editor.locator('h1')).toHaveText(title, { timeout: 30_000 })
      await expect(editor.locator('h2')).toHaveText(['Definitions', 'Payment Terms'])
      await expect(editor.locator('strong')).toHaveText('Alpha Ltd')
      await expect(editor.locator('table')).toContainText('Signing')
      await expect(editor).not.toContainText('__mdInjected')

      const outlineToggle = page.getByRole('button', { name: 'Outline', exact: true })
      const outline = page.getByRole('navigation', { name: 'Outline' })
      if (!(await outline.isVisible())) await outlineToggle.click()
      await expect(outline).toBeVisible()
      await expect(outline.getByRole('button', { name: /Definitions/ })).toBeVisible()
      await expect(outline.getByRole('button', { name: /Payment Terms/ })).toBeVisible()

      const detail = await apiRequest(request, 'GET', `/api/documents/${encodeURIComponent(documentId ?? '')}`, { token })
      const detailBody = await readJsonSafe<{ title?: string }>(detail)
      expect(detailBody?.title).toBe(title)
      const content = await apiRequest(request, 'GET', `/api/documents/${encodeURIComponent(documentId ?? '')}/content`, { token })
      const contentBody = await readJsonSafe<{ contentHtml?: string }>(content)
      expect(contentBody?.contentHtml ?? '').toContain('<h2>Definitions</h2>')
      expect(contentBody?.contentHtml ?? '').not.toContain('<script')
    } finally {
      await deleteDocumentIfExists(request, token, documentId)
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
