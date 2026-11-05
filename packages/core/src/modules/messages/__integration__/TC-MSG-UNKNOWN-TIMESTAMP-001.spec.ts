import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { composeInternalMessage, deleteMessageIfExists } from './helpers'

test('an undated sent message stays unknown in detail, list, and forwarding', async ({ page, request }) => {
  let messageId: string | null = null
  let senderToken: string | null = null
  try {
    const fixture = await composeInternalMessage(request, { subject: `Unknown timestamp ${Date.now()}` })
    messageId = fixture.messageId
    senderToken = fixture.senderToken
    await withClient(async (client) => {
      const result = await client.query('UPDATE messages SET sent_at = NULL WHERE id = $1 RETURNING id', [messageId])
      expect(result.rowCount).toBe(1)
    })

    const detail = await apiRequest(request, 'GET', `/api/messages/${messageId}`, { token: senderToken })
    expect(detail.status()).toBe(200)
    const record = await readJsonSafe<{ sentAt: string | null; isDraft: boolean }>(detail)
    expect(record?.sentAt).toBeNull()
    expect(record?.isDraft).toBe(false)

    const list = await apiRequest(request, 'GET', `/api/messages?folder=sent&search=${encodeURIComponent(fixture.subject)}`, { token: senderToken })
    expect(list.status()).toBe(200)
    const items = await readJsonSafe<{ items: Array<{ id: string; sentAt: string | null }> }>(list)
    expect(items?.items.find((item) => item.id === messageId)?.sentAt).toBeNull()

    const preview = await apiRequest(request, 'GET', `/api/messages/${messageId}/forward-preview`, { token: senderToken })
    expect(preview.status()).toBe(200)
    const forwarded = await readJsonSafe<{ body: string }>(preview)
    expect(forwarded?.body).toContain('Date: -')

    await login(page, 'admin')
    await page.goto(`/backend/messages/${messageId}`)
    await expect(page.getByText('Unknown date', { exact: true })).toBeVisible()
  } finally {
    await deleteMessageIfExists(request, senderToken, messageId)
  }
})
