import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'

for (const width of [1440, 390]) {
  test(`TC-STAFF-8519: code toolbar geometry and controls at ${width}px`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const token = await getAuthToken(request)
    const teamName = `Toolbar regression ${randomUUID()}`
    let teamId: string | null = null

    try {
      const created = await apiRequest(request, 'POST', '/api/staff/teams', {
        token,
        data: {
          name: teamName,
          description: '```typescript\nconst toolbarValue = 42\n```\n\nFollowing paragraph survives.',
          isActive: true,
        },
      })
      expect(created.status()).toBe(201)
      teamId = expectId((await readJsonSafe<{ id?: string }>(created))?.id, 'owned team id')

      await login(page, 'admin')
      await page.goto(`/backend/staff/teams/${teamId}/edit`)
      const description = page.locator('[data-crud-field-id="description"]')
      const language = description.getByRole('combobox', { name: 'Language', exact: true })
      const code = description.getByRole('textbox').filter({ hasText: 'const toolbarValue = 42' }).last()
      await expect(language).toBeVisible()
      await expect(code).toBeVisible()

      await expect.poll(async () => description.locator('[class*=codeMirrorWrapper]').evaluate((wrapper) => {
        const toolbar = wrapper.querySelector('[class*=codeMirrorToolbar]')?.getBoundingClientRect()
        const line = wrapper.querySelector('.cm-line')?.getBoundingClientRect()
        const editor = wrapper.closest('.om-mdx-editor')?.getBoundingClientRect()
        if (!toolbar || !line || !editor) return false
        return toolbar.height > 0 && toolbar.bottom <= line.top + 1
          && toolbar.left >= editor.left - 1 && toolbar.right <= editor.right + 1
      }), 'vendor toolbar remains above code and inside the editor').toBe(true)

      await language.click()
      await expect(page.getByRole('option', { name: 'JavaScript', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('listbox')).toHaveCount(0)
      await expect(code).toHaveText('const toolbarValue = 42')
      await expect(language).toHaveText('typescript')

      await language.click()
      await page.getByRole('option', { name: 'JavaScript', exact: true }).click()
      await expect(language).toHaveText('JavaScript')
      await expect(code).toHaveAttribute('data-language', 'javascript')
      await expect(code).toHaveText('const toolbarValue = 42')
      await testInfo.attach(`toolbar-${width}`, { body: await page.screenshot(), contentType: 'image/png' })

      await description.getByRole('button', { name: 'Delete code block', exact: true }).click()
      await expect(language).toHaveCount(0)
      await expect(description.getByText('Following paragraph survives.', { exact: true })).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Name *', exact: true })).toHaveValue(teamName)
      await expect(page.getByRole('button', { name: 'Save', exact: true }).first()).toBeEnabled()
    } finally {
      if (teamId) {
        const current = await apiRequest(request, 'GET', `/api/staff/teams?id=${teamId}`, { token })
        expect(current.status()).toBe(200)
        const record = (await readJsonSafe<{ items?: Array<{ id: string; updatedAt?: string; updated_at?: string }> }>(current))?.items?.find((item) => item.id === teamId)
        expect(record, 'owned team is available for versioned cleanup').toBeDefined()
        const version = record?.updatedAt ?? record?.updated_at
        expect(typeof version, 'cleanup uses the current record version').toBe('string')
        expect(version).not.toBe('')
        const removed = await apiRequest(request, 'DELETE', `/api/staff/teams?id=${teamId}`, {
          token,
          headers: buildOptimisticLockHeader(version),
        })
        expect(removed.status(), 'owned team cleanup succeeds').toBe(200)
      }
    }
  })
}
