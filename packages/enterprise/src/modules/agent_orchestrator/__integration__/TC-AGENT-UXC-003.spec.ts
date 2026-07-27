import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AGENT-UXC-003: cron validation is semantic, not shape-only, and the
 * create form previews the next runs.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-consistency-pass.md
 * (Area 7: scheduler `validateCronExpression` wired into the tasks CRUD
 * validators + live "Next runs" preview).
 *
 * Legs:
 * 1. API — `POST /tasks` with `scheduleCron: "foo bar baz qux quux"` (five
 *    perfectly shaped garbage tokens that pass the token-count regex) → 400
 *    with a scheduleCron issue; a valid 5-field expression → created.
 * 2. UI — the create form shows three upcoming occurrences once a valid cron
 *    is typed, and the invalid-schedule note for garbage.
 */

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

test.describe('TC-AGENT-UXC-003: semantic cron validation + next-run preview', () => {
  test('shape-valid garbage is rejected server-side; a valid cron creates', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let taskId: string | null = null

    try {
      const garbage = await apiRequest(request, 'POST', '/api/agent_orchestrator/tasks', {
        token,
        data: {
          name: `TC-UXC-003 garbage ${stamp}`,
          targetType: 'agent',
          targetAgentId: 'deals.health_check',
          scheduleCron: 'foo bar baz qux quux',
        },
      })
      expect(garbage.status(), 'five shaped garbage tokens must fail semantic validation').toBe(400)
      const garbageBody = await readJsonSafe<Record<string, unknown>>(garbage)
      expect(JSON.stringify(garbageBody)).toContain('scheduleCron')

      const valid = await apiRequest(request, 'POST', '/api/agent_orchestrator/tasks', {
        token,
        data: {
          name: `TC-UXC-003 valid ${stamp}`,
          targetType: 'agent',
          targetAgentId: 'deals.health_check',
          scheduleCron: '0 7 * * 1',
          scheduleTimezone: 'Europe/Warsaw',
        },
      })
      expect(valid.ok(), 'a real weekly cron must pass').toBeTruthy()
      taskId = (await readJsonSafe<{ id?: string }>(valid))?.id ?? null
      expect(taskId).toBeTruthy()
    } finally {
      if (taskId) {
        await apiRequest(request, 'DELETE', `/api/agent_orchestrator/tasks?id=${encodeURIComponent(taskId)}`, {
          token,
        }).catch(() => {})
      }
    }
  })

  test('create form previews three next runs for a valid cron', async ({ page }) => {
    test.slow()
    await loginAsAdmin(page)
    await page.goto('/backend/agentic-tasks', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /new task/i }).click()

    const cronInput = page.getByLabel(/cron schedule/i)
    await expect(cronInput).toBeVisible({ timeout: 10_000 })

    await cronInput.fill('0 7 * * 1')
    const preview = page.getByText(/next runs:/i)
    await expect(preview).toBeVisible({ timeout: 5_000 })
    // Three occurrences joined by the " · " separator → exactly two separators.
    const previewText = (await preview.textContent()) ?? ''
    expect(previewText.split('·')).toHaveLength(3)

    await cronInput.fill('foo bar baz qux quux')
    await expect(page.getByText(/schedule inactive/i)).toBeVisible({ timeout: 5_000 })
  })
})
