import { randomUUID } from 'node:crypto'
import { test as base, expect, type APIRequestContext, type Locator, type Page, type TestInfo } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture, setUserAclVisibility } from '@open-mercato/core/helpers/integration/authFixtures'
import { createCompanyFixture, createPersonFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { createInteractionFixture, listInteractionsInWindow, type InteractionFixtureInput } from './helpers/calendarFixtures'
import { authenticateCrm, cleanupCrmFixtures } from './helpers/umesFixtures'

const scheduledAt = '2026-11-03T23:30:00.000Z'
type CalendarAccount = { request: APIRequestContext; token: string }
const test = base.extend<{}, { calendarAccount: CalendarAccount }>({
  calendarAccount: [async ({ playwright }, provideAccount) => {
    const request = await playwright.request.newContext()
    const cleanups: Array<() => Promise<void>> = []
    try {
      const token = await getAuthToken(request, 'admin', process.env.TEST_ADMIN_PASSWORD)
      const { organizationId } = getTokenContext(token)
      const email = `tc-crm-8603-${randomUUID()}@example.com`
      const password = `Qa1!${randomUUID()}`
      const userId = await createUserFixture(request, token, {
        email, password, organizationId, roles: ['admin'], name: 'Calendar QA',
      })
      cleanups.push(async () => {
        const response = await apiRequest(request, 'DELETE', `/api/auth/users?id=${userId}`, { token })
        expect(response.ok(), 'Cleanup owned CRM user succeeds').toBe(true)
      })
      await setUserAclVisibility(request, token, { userId, organizations: [organizationId], features: ['customers.*', 'auth.users.view'] })
      await provideAccount({ request, token: await getAuthToken(request, email, password) })
    } finally {
      try {
        await cleanupCrmFixtures(cleanups)
      } finally {
        await request.dispose()
      }
    }
  }, { scope: 'worker' }],
})

type CustomerKind = 'companies' | 'people'
type ActivityContext = { calendar: Locator; entityId: string; interactionId: string | null; token: string }

test.use({ locale: 'en-US', timezoneId: 'Europe/Warsaw', hasTouch: true })

function activityPath(kind: CustomerKind, entityId: string): string {
  const query = kind === 'companies' ? 'tab=activity-log' : 'tab=activities&zone=activity'
  return `/backend/customers/${kind}-v2/${entityId}?${query}`
}

async function withActivityPage(
  page: Page,
  account: CalendarAccount,
  kind: CustomerKind,
  populated: boolean,
  run: (activity: ActivityContext) => Promise<void>,
  interactionFields: Partial<Omit<InteractionFixtureInput, 'entityId' | 'scheduledAt'>> = {},
): Promise<void> {
  const { request } = account
  const token = await authenticateCrm(page, request)
  const cleanups: Array<() => Promise<void>> = []
  const ownRecord = (path: string, id: string): void => {
    cleanups.unshift(async () => {
      const response = await apiRequest(request, 'DELETE', `${path}?id=${id}`, { token })
      expect(response.ok(), `Cleanup ${path} succeeds`).toBe(true)
    })
  }
  try {
    await page.context().addCookies([{ name: 'auth_token', value: account.token, url: process.env.BASE_URL as string }])
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00.000Z'))
    const entityId = kind === 'companies'
      ? await createCompanyFixture(request, token, 'Calendar QA')
      : await createPersonFixture(request, token, { firstName: 'Calendar', lastName: 'QA', displayName: 'Calendar QA' })
    ownRecord(`/api/customers/${kind}`, entityId)
    let interactionId: string | null = null
    if (populated) {
      interactionId = await createInteractionFixture(request, token, {
        entityId, interactionType: 'meeting', title: 'Calendar meeting',
        scheduledAt: new Date(scheduledAt), status: 'done', durationMinutes: 30,
        ...interactionFields,
      })
      ownRecord('/api/customers/interactions', interactionId)
    }
    const isMobilePerson = kind === 'people' && (page.viewportSize()?.width ?? 1440) <= 767
    const formDefinitions = isMobilePerson
      ? null
      : page.waitForResponse((response) => {
          const url = new URL(response.url())
          return url.pathname === '/api/entities/definitions'
            && url.searchParams.getAll('entityId').includes('customers:customer_entity')
        })
    await page.goto(activityPath(kind, entityId))
    if (formDefinitions) {
      const definitionsResponse = await formDefinitions
      expect(definitionsResponse.ok()).toBe(true)
      await definitionsResponse.finished()
    }
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))
    const calendar = page.locator('#inline-activity-composer-week-preview')
    await expect(calendar).toBeVisible()
    await expect(page.getByRole('heading', { name: /^Interaction history/ })).toBeVisible()
    if (populated) await expect(historyActivity(page, 'Calendar meeting')).toBeVisible()
    await run({ calendar, entityId, interactionId, token })
  } finally {
    await cleanupCrmFixtures(cleanups)
  }
}

async function assertCalendarBounds(calendar: Locator): Promise<void> {
  const bounds = await calendar.evaluate((element) => {
    const calendarBox = element.getBoundingClientRect()
    return {
      left: calendarBox.left,
      right: calendarBox.right,
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      scrollX: window.scrollX,
      controls: Array.from(element.querySelectorAll('button')).map((button) => {
        const box = button.getBoundingClientRect()
        return { left: box.left, right: box.right }
      }),
    }
  })
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport)
  expect(bounds.documentWidth).toBeLessThanOrEqual(bounds.viewport)
  expect(bounds.scrollX).toBe(0)
  expect(bounds.controls).toHaveLength(9)
  for (const control of bounds.controls) {
    expect(control.left).toBeGreaterThanOrEqual(bounds.left)
    expect(control.right).toBeLessThanOrEqual(bounds.right)
  }
}

async function attachEvidence(calendar: Locator, testInfo: TestInfo): Promise<void> {
  const geometry = await calendar.evaluate((element) => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    calendarWidth: element.getBoundingClientRect().width,
    domContentLoadedMs: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.domContentLoadedEventEnd ?? null,
  }))
  await testInfo.attach('calendar-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' })
  await testInfo.attach('calendar', { body: await calendar.screenshot(), contentType: 'image/png' })
}

function historyActivity(page: Page, title: string): Locator {
  return page.getByRole('button').filter({ hasText: title })
}

for (const kind of ['companies', 'people'] as const) {
  for (const populated of [false, true]) {
    for (const width of [390, 1440]) {
      test.describe(`${kind} ${populated ? 'populated' : 'empty'} at ${width}px`, () => {
        test.use({ hasTouch: width === 390 })
        for (const inputMode of ['pointer', 'keyboard'] as const) {
          test(`TC-CRM-8603 keeps week preview controls reachable by ${inputMode}`, async ({ page, calendarAccount }, testInfo) => {
            await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
            await withActivityPage(page, calendarAccount, kind, populated, async ({ calendar }) => {
              const dates = calendar.getByRole('button', { name: /^\d+$/ })
              const date = (day: number) => calendar.getByRole('button', { name: String(day), exact: true })
              const previousWeek = calendar.getByRole('button', { name: 'Previous week', exact: true })
              const nextWeek = calendar.getByRole('button', { name: 'Next week', exact: true })
              const meeting = calendar.getByText('Calendar meeting', { exact: true })
              const activate = async (control: Locator): Promise<void> => {
                if (inputMode === 'keyboard') {
                  await control.focus()
                  await page.keyboard.press('Enter')
                } else if (width === 390) {
                  await control.tap()
                } else {
                  await control.click()
                }
              }

              await expect(dates).toHaveText(['2', '3', '4', '5', '6', '7', '8'])
              await expect(date(4)).toHaveAttribute('aria-pressed', 'true')
              await expect(meeting).toHaveCount(populated ? 1 : 0)
              await assertCalendarBounds(calendar)
              if (inputMode === 'pointer') await attachEvidence(calendar, testInfo)
              if (inputMode === 'keyboard') await nextWeek.focus()

              for (const day of [2, 3, 4, 5, 6, 7, 8]) {
                const control = date(day)
                if (inputMode === 'keyboard') {
                  await page.keyboard.press('Tab')
                  await expect(control).toBeFocused()
                  await page.keyboard.press('Enter')
                } else {
                  await activate(control)
                }
                await expect(control).toHaveAttribute('aria-pressed', 'true')
                await expect(calendar.getByRole('button', { pressed: true })).toHaveCount(1)
                await assertCalendarBounds(calendar)
              }

              await expect(meeting).toHaveCount(0)
              await activate(date(4))
              await expect(meeting).toHaveCount(populated ? 1 : 0)

              await activate(nextWeek)
              await expect(dates).toHaveText(['9', '10', '11', '12', '13', '14', '15'])
              await expect(meeting).toHaveCount(0)
              await activate(previousWeek)
              await expect(dates).toHaveText(['2', '3', '4', '5', '6', '7', '8'])
              await expect(meeting).toHaveCount(populated ? 1 : 0)
              await activate(previousWeek)
              await expect(calendar.getByText('October 2026', { exact: true })).toBeVisible()
              await expect(dates).toHaveText(['26', '27', '28', '29', '30', '31', '1'])
              await activate(nextWeek)
              await expect(calendar.getByText('This week — November 2026', { exact: true })).toBeVisible()
              await expect(date(4)).toHaveAttribute('aria-pressed', 'true')
              await expect(meeting).toHaveCount(populated ? 1 : 0)
              await assertCalendarBounds(calendar)
            })
          })
        }
      })
    }
  }

  test(`TC-CRM-8603 ${kind} preserves completed activity local date when editing or canceling`, async ({ page, calendarAccount }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await withActivityPage(page, calendarAccount, kind, true, async ({ calendar, entityId, interactionId, token }) => {
      await historyActivity(page, 'Calendar meeting').click()
      const dialog = page.getByRole('dialog', { name: 'Edit activity' })
      await expect(dialog.getByRole('button', { name: 'Nov 4, 2026', exact: true })).toBeVisible()
      await expect(dialog.getByRole('button', { name: '12:30 AM', exact: true })).toBeVisible()
      await dialog.getByRole('textbox', { name: 'Activity title...' }).fill('Calendar updated')
      await dialog.getByRole('button', { name: 'Update activity', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect(historyActivity(page, 'Calendar updated')).toBeVisible()
      await expect(calendar.getByRole('button', { name: '4', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await historyActivity(page, 'Calendar updated').click()
      await expect(dialog.getByRole('textbox', { name: 'Activity title...' })).toHaveValue('Calendar updated')
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      const interactions = await listInteractionsInWindow(calendarAccount.request, token, {
        entityId, from: new Date('2026-11-03T23:00:00.000Z'), to: new Date('2026-11-04T22:59:59.999Z'),
      })
      const saved = interactions.find((interaction) => interaction.id === interactionId)
      expect(saved?.title).toBe('Calendar updated')
      expect(saved?.status).toBe('done')
      expect(new Date(saved!.scheduledAt!).toISOString()).toBe(scheduledAt)
      await assertCalendarBounds(calendar)
    })
  })

  for (const concurrentEdit of [false, true]) {
    test(`TC-CRM-8730 ${kind} preserves untouched activity fields${concurrentEdit ? ' after a stale edit and retry' : ''}`, async ({ page, calendarAccount }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await withActivityPage(page, calendarAccount, kind, true, async ({ entityId, interactionId, token }) => {
        const readRecord = async (): Promise<Record<string, unknown> & { updatedAt: string }> => {
          const params = new URLSearchParams({ entityId, pageSize: '100' })
          const response = await apiRequest(calendarAccount.request, 'GET', `/api/customers/interactions?${params}`, { token })
          expect(response.status()).toBe(200)
          const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
          const record = body?.items?.find((item) => item.id === interactionId)
          if (!record || typeof record.updatedAt !== 'string') throw new Error('Owned interaction version is missing')
          return { ...record, updatedAt: record.updatedAt }
        }
        const initial = await readRecord()
        expect(initial).toMatchObject({ allDay: null, reminderMinutes: null, visibility: null, location: 'Original room' })
        await historyActivity(page, 'Calendar meeting').click()
        const dialog = page.getByRole('dialog', { name: 'Edit activity' })
        await dialog.getByPlaceholder('Add location or meeting link...').fill('Updated room')
        let beforeSave = initial

        if (concurrentEdit) {
          const concurrent = await apiRequest(calendarAccount.request, 'PUT', '/api/customers/interactions', {
            token,
            headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: initial.updatedAt },
            data: { id: interactionId, title: 'Concurrent title' },
          })
          expect(concurrent.status()).toBe(200)
          beforeSave = await readRecord()
          expect(beforeSave.updatedAt).not.toBe(initial.updatedAt)
          expect(beforeSave).toEqual({ ...initial, title: 'Concurrent title', updatedAt: beforeSave.updatedAt })
          const rejected = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/customers/interactions' && response.request().method() === 'PUT')
          await dialog.getByRole('button', { name: 'Update activity', exact: true }).click()
          const rejection = await rejected
          expect(rejection.status()).toBe(409)
          expect(rejection.request().headers()[OPTIMISTIC_LOCK_HEADER_NAME]).toBe(initial.updatedAt)
          expect(await readRecord()).toEqual(beforeSave)
          await page.reload()
          await historyActivity(page, 'Concurrent title').click()
          await dialog.getByPlaceholder('Add location or meeting link...').fill('Updated room')
        }

        const savedResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/customers/interactions' && response.request().method() === 'PUT')
        await dialog.getByRole('button', { name: 'Update activity', exact: true }).click()
        const response = await savedResponse
        expect(response.status()).toBe(200)
        expect(response.request().headers()[OPTIMISTIC_LOCK_HEADER_NAME]).toBe(beforeSave.updatedAt)
        const payload = response.request().postDataJSON() as Record<string, unknown>
        for (const field of ['allDay', 'reminderMinutes', 'visibility']) expect(payload).not.toHaveProperty(field)
        const saved = await readRecord()
        expect(saved.updatedAt).not.toBe(beforeSave.updatedAt)
        expect(saved).toEqual({ ...beforeSave, location: 'Updated room', updatedAt: saved.updatedAt })
      }, { allDay: null, reminderMinutes: null, visibility: null, location: 'Original room' })
    })
  }
}
