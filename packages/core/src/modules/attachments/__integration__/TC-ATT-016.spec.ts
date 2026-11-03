import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { deleteAttachmentIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

export const integrationMeta = {
  dependsOnModules: ['attachments', 'customers'],
}

/**
 * TC-ATT-016: Multi-file upload stops at a rejected file without duplicating saved files
 * Source: GitHub issue #6397
 * Surfaces: /backend/storage/attachments upload dialog (AttachmentLibrary) and the
 * company "Files" tab (shared AttachmentsSection), both backed by POST /api/attachments.
 *
 * The middle file is a harmless `.exe`, which the route rejects with 400 through its
 * dangerous-executable validation. Files saved before the rejection must be visible
 * immediately, and a retry from the library dialog must send only the rejected and
 * never-attempted files, so every file ends up persisted exactly once.
 */

type ListedAttachment = { id: string; fileName: string }

function textFile(name: string) {
  return { name, mimeType: name.endsWith('.exe') ? 'application/octet-stream' : 'text/plain', buffer: Buffer.from(`harmless text for ${name}\n`) }
}

async function listLibrary(request: APIRequestContext, token: string, search: string): Promise<ListedAttachment[]> {
  const response = await apiRequest(request, 'GET', `/api/attachments/library?search=${encodeURIComponent(search)}&pageSize=100`, { token })
  expect(response.ok(), `library list failed: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ items?: ListedAttachment[] }>(response)
  return body?.items ?? []
}

async function listRecord(request: APIRequestContext, token: string, entityId: string, recordId: string): Promise<ListedAttachment[]> {
  const params = new URLSearchParams({ entityId, recordId, pageSize: '100' })
  const response = await apiRequest(request, 'GET', `/api/attachments?${params.toString()}`, { token })
  expect(response.ok(), `record attachments list failed: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ items?: ListedAttachment[] }>(response)
  return body?.items ?? []
}

function isRejectedUpload(response: { url(): string; status(): number; request(): { method(): string } }): boolean {
  return response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/attachments' && response.status() === 400
}

function countByName(items: ListedAttachment[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item.fileName] = (acc[item.fileName] ?? 0) + 1
    return acc
  }, {})
}

test.describe('TC-ATT-016: Multi-file upload partial failure (#6397)', () => {
  test('library dialog shows saved files and retries only the rejected and unattempted files', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const tag = randomUUID().slice(0, 8)
    const first = `tc016-${tag}-first.txt`
    const blocked = `tc016-${tag}-blocked.exe`
    const last = `tc016-${tag}-last.txt`
    let created: ListedAttachment[] = []

    try {
      await login(page, 'admin')
      await page.goto('/backend/storage/attachments')
      await page.getByRole('button', { name: 'Upload', exact: true }).first().click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog.locator('input[type="file"]').setInputFiles([first, blocked, last].map(textFile))
      await expect(dialog.getByText(last, { exact: true })).toBeVisible()

      const submit = dialog.getByRole('button', { name: 'Upload', exact: true })
      const rejected = page.waitForResponse(isRejectedUpload)
      await submit.click()
      const rejectionBody = (await (await rejected).json()) as { error?: string } | null
      expect(rejectionBody?.error, 'rejection must carry an error message').toBeTruthy()
      await expect(page.getByText(rejectionBody!.error!, { exact: true }).first()).toBeVisible()
      await expect(submit).toBeEnabled()

      created = await listLibrary(request, token, `tc016-${tag}`)
      expect(countByName(created)).toEqual({ [first]: 1 })
      await expect(page.locator('table').getByText(first, { exact: true })).toBeVisible()
      await expect(dialog.getByText(first, { exact: true })).toHaveCount(0)
      await expect(dialog.getByText(blocked, { exact: true })).toBeVisible()
      await expect(dialog.getByText(last, { exact: true })).toBeVisible()

      const retryPosts: string[] = []
      const recordPost = (req: { url(): string; method(): string }) => {
        if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/attachments') retryPosts.push(req.url())
      }
      page.on('request', recordPost)
      const rejectedAgain = page.waitForResponse(isRejectedUpload)
      await submit.click()
      await rejectedAgain
      await expect(submit).toBeEnabled()
      page.off('request', recordPost)
      expect(retryPosts, 'retry must send only the rejected file before stopping').toHaveLength(1)
      created = await listLibrary(request, token, `tc016-${tag}`)
      expect(countByName(created)).toEqual({ [first]: 1 })

      const blockedRow = dialog.locator('div.rounded.border', { has: page.getByText(blocked, { exact: true }) })
      await blockedRow.getByRole('button').click()
      await expect(dialog.getByText(blocked, { exact: true })).toHaveCount(0)
      await submit.click()
      await expect(dialog).toBeHidden()

      created = await listLibrary(request, token, `tc016-${tag}`)
      expect(countByName(created)).toEqual({ [first]: 1, [last]: 1 })
      await page.reload()
      await expect(page.locator('table').getByText(first, { exact: true })).toHaveCount(1)
      await expect(page.locator('table').getByText(last, { exact: true })).toHaveCount(1)
    } finally {
      created = await listLibrary(request, token, `tc016-${tag}`).catch(() => created)
      for (const item of created) await deleteAttachmentIfExists(request, token, item.id)
    }
  })

  test('record Files tab shows files saved before a rejected file without a reload', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const tag = randomUUID().slice(0, 8)
    const first = `tc016-${tag}-first.txt`
    const blocked = `tc016-${tag}-blocked.exe`
    const last = `tc016-${tag}-last.txt`
    const entityId = 'customers:customer_entity'
    let companyId: string | null = null
    let created: ListedAttachment[] = []

    try {
      companyId = await createCompanyFixture(request, token, `TC-ATT-016 ${tag}`)
      await login(page, 'admin')
      await page.goto(`/backend/customers/companies-v2/${companyId}?tab=files`)
      const section = page.locator('[data-component-handle*="AttachmentsSection"]')
      await expect(section.getByRole('button', { name: 'Choose files' })).toBeVisible()

      await section.locator('input[type="file"]').setInputFiles([first, blocked, last].map(textFile))

      await expect(section.getByRole('alert')).toContainText(/executable/i)
      await expect(section.getByRole('button', { name: first, exact: true })).toBeVisible()
      await expect(section.getByText('No attachments found.')).toHaveCount(0)
      await expect(section.getByRole('button', { name: last, exact: true })).toHaveCount(0)

      created = await listRecord(request, token, entityId, companyId)
      expect(countByName(created)).toEqual({ [first]: 1 })

      await page.reload()
      await expect(section.getByRole('button', { name: first, exact: true })).toHaveCount(1)
    } finally {
      if (companyId) {
        created = await listRecord(request, token, entityId, companyId).catch(() => created)
        for (const item of created) await deleteAttachmentIfExists(request, token, item.id)
        await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
      }
    }
  })
})
