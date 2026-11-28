import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createPersonFixture, deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/crmFixtures'

const interactionsPath = '/api/customers/interactions'

async function listMeetings(request: APIRequestContext, token: string, personId: string) {
  const response = await apiRequest(request, 'GET', `${interactionsPath}?entityId=${personId}&interactionType=meeting&limit=100`, { token })
  expect(response.ok()).toBeTruthy()
  const body = await readJsonSafe<{ items: Array<{ id: string; title: string; scheduledAt: string | null }> }>(response)
  return body?.items ?? []
}

test('TC-CRM-10449: repeated meeting confirmations persist one record per draft', async ({ page, request }) => {
  const token = await getAuthToken(request, 'admin')
  const personId = await createPersonFixture(request, token, {
    firstName: 'QA',
    lastName: 'Scheduling',
    displayName: `QA TC-CRM-10449 ${Date.now()}`,
  })
  const writes: Array<Promise<APIResponse>> = []
  let allowWrites = Promise.resolve()

  try {
    await login(page, 'admin')
    await page.clock.setFixedTime(new Date())
    await page.goto(`/backend/customers/people-v2/${personId}?tab=activities`, { waitUntil: 'domcontentloaded' })
    const schedule = page.getByRole('button', { name: 'Schedule', exact: true }).first()
    const dialog = page.getByRole('dialog', { name: 'New meeting' })

    await page.route((url) => url.pathname === interactionsPath, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback()
        return
      }
      const write = allowWrites.then(() => route.fetch())
      writes.push(write)
      await route.fulfill({ response: await write })
    })

    const meetings = [
      { title: 'QA single confirmation', confirmation: 'single' },
      { title: 'QA repeated keyboard confirmation', confirmation: 'keyboard' },
      { title: 'QA mixed button and keyboard confirmation', confirmation: 'mixed' },
    ] as const
    for (const { title, confirmation } of meetings) {
      await schedule.click()
      const titleField = dialog.getByPlaceholder('Activity title...')
      const saveButton = dialog.getByRole('button', { name: 'Save activity', exact: true })
      await titleField.fill(title)
      await expect(saveButton).toBeEnabled()

      const previousWriteCount = writes.length
      let resumeWrites = () => {}
      allowWrites = new Promise<void>((resolve) => { resumeWrites = resolve })
      try {
        if (confirmation === 'keyboard') await titleField.press('Control+Enter')
        else await saveButton.click()
        await expect.poll(() => writes.length).toBe(previousWriteCount + 1)
        await expect(dialog.getByRole('button', { name: 'Saving...' })).toBeDisabled()
        if (confirmation !== 'single') await titleField.press('Control+Enter')
      } finally {
        resumeWrites()
      }

      await expect(dialog).toBeHidden()
      const responses = await Promise.all(writes.slice(previousWriteCount))
      expect(responses.map((response) => response.status())).toEqual([201])
    }

    const persisted = await listMeetings(request, token, personId)
    expect(persisted.map(({ title }) => title).sort()).toEqual(meetings.map(({ title }) => title).sort())
    const scheduledTimes = persisted.map(({ scheduledAt }) => scheduledAt)
    expect(scheduledTimes.every((time) => Boolean(time))).toBe(true)
    expect(new Set(scheduledTimes).size).toBe(1)
  } finally {
    await Promise.allSettled(writes)
    try {
      const persisted = await listMeetings(request, token, personId)
      for (const { id } of persisted) await deleteEntityIfExists(request, token, interactionsPath, id)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  }
})
