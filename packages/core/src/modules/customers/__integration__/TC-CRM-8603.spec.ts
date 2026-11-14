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
const calendarName = /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/
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
type CalendarContext = { card: Locator; dates: Locator; entityId: string; interactionId: string | null; token: string }

test.use({ locale: 'en-US', timezoneId: 'Europe/Warsaw', hasTouch: true })

async function withCalendar(
  page: Page,
  account: CalendarAccount,
  kind: CustomerKind,
  populated: boolean,
  run: (calendar: CalendarContext) => Promise<void>,
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
    const formDefinitions = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === '/api/entities/definitions'
        && url.searchParams.getAll('entityId').includes('customers:customer_entity')
    })
    await page.goto(`/backend/customers/${kind}-v2/${entityId}`)
    const definitionsResponse = await formDefinitions
    expect(definitionsResponse.ok()).toBe(true)
    await definitionsResponse.finished()
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))
    const activityTab = page.getByRole('tab', { name: kind === 'companies' ? /^Activity log(?: \d+)?$/ : 'Activity', exact: true })
    if (kind === 'companies' || page.viewportSize()!.width === 390) {
      await expect(activityTab).toBeVisible()
      await activityTab.click()
    }
    const card = page.getByRole('heading', { name: 'Activities', level: 3, exact: true }).locator('../../..')
    const dates = card.getByRole('group', { name: calendarName })
    await expect(dates.getByRole('button')).toHaveCount(5)
    await expect(dates.getByRole('button', { name: 'WED 04' })).toHaveAttribute('aria-pressed', 'true')
    await expect(card.getByText(populated ? 'Calendar meeting' : 'Nothing scheduled for this day.', { exact: true })).toBeVisible()
    await run({ card, dates, entityId, interactionId, token })
  } finally {
    await cleanupCrmFixtures(cleanups)
  }
}

async function assertBounds(card: Locator): Promise<void> {
  const bounds = await card.evaluate((element) => {
    const controls = ['Previous month', 'Next month', 'Previous days', 'Next days']
    return {
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      scrollX: window.scrollX,
      controls: Array.from(element.querySelectorAll('button[aria-label]'))
        .filter((button) => controls.includes(button.getAttribute('aria-label') ?? ''))
        .map((button) => ({ left: button.getBoundingClientRect().left, right: button.getBoundingClientRect().right })),
    }
  })
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport)
  expect(bounds.documentWidth).toBeLessThanOrEqual(bounds.viewport)
  expect(bounds.scrollX).toBe(0)
  expect(bounds.controls).toHaveLength(4)
  for (const button of bounds.controls) {
    expect(button.left).toBeGreaterThanOrEqual(bounds.left)
    expect(button.right).toBeLessThanOrEqual(bounds.right)
  }
}

async function assertDateVisible(button: Locator): Promise<void> {
  const bounds = await button.evaluate((element) => {
    const viewport = element.closest('[role="group"]')?.getBoundingClientRect()
    const date = element.getBoundingClientRect()
    return { left: date.left, right: date.right, viewportLeft: viewport?.left, viewportRight: viewport?.right }
  })
  expect(bounds.viewportLeft).toBeDefined()
  expect(bounds.viewportRight).toBeDefined()
  expect(bounds.left).toBeGreaterThanOrEqual(bounds.viewportLeft! - 1)
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportRight! + 1)
}

async function attachEvidence(card: Locator, dates: Locator, testInfo: TestInfo): Promise<void> {
  const geometry = await dates.evaluate((element) => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    dateViewport: element.clientWidth,
    dateContent: element.scrollWidth,
    scrollLeft: element.scrollLeft,
    domContentLoadedMs: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.domContentLoadedEventEnd ?? null,
  }))
  await testInfo.attach('calendar-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' })
  await testInfo.attach('calendar', { body: await card.screenshot(), contentType: 'image/png' })
}

for (const kind of ['companies', 'people'] as const) {
  for (const populated of [false, true]) {
    for (const width of [390, 1440]) {
      test.describe(`${kind} ${populated ? 'populated' : 'empty'} at ${width}px`, () => {
        test.use({ hasTouch: width === 390 })
        for (const inputMode of ['pointer', 'keyboard'] as const) {
          test(`TC-CRM-8603 keeps calendar controls reachable by ${inputMode}`, async ({ page, calendarAccount }, testInfo) => {
            await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
            await withCalendar(page, calendarAccount, kind, populated, async ({ card, dates }) => {
              await assertBounds(card)
              if (inputMode === 'pointer') await attachEvidence(card, dates, testInfo)
              const buttons = dates.getByRole('button')
              const initialNames = await buttons.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label')))
              const dimensions = await dates.evaluate((element) => ({ viewport: element.clientWidth, content: element.scrollWidth }))
              if (width === 390) {
                expect(dimensions.content).toBeGreaterThan(dimensions.viewport)
              } else {
                expect(dimensions.content).toBe(dimensions.viewport)
                for (const button of await buttons.all()) await assertDateVisible(button)
              }
              if (width === 390 && inputMode === 'pointer') {
                await dates.hover()
                await page.mouse.wheel(600, 0)
                await expect.poll(() => dates.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
                await page.mouse.wheel(-600, 0)
                await expect.poll(() => dates.evaluate((element) => element.scrollLeft)).toBe(0)
                const box = await dates.boundingBox()
                expect(box).not.toBeNull()
                const touch = await page.context().newCDPSession(page)
                try {
                  const startX = box!.x + box!.width - 16
                  const centerY = box!.y + box!.height / 2
                  await touch.send('Input.dispatchTouchEvent', {
                    type: 'touchStart', touchPoints: [{ x: startX, y: centerY }],
                  })
                  for (let step = 1; step <= 6; step += 1) {
                    await touch.send('Input.dispatchTouchEvent', {
                      type: 'touchMove', touchPoints: [{ x: startX - (box!.width - 32) * step / 6, y: centerY }],
                    })
                  }
                  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
                  await expect.poll(() => dates.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
                } finally {
                  await touch.detach()
                }
              }
              if (inputMode === 'pointer') {
                for (const button of await buttons.all()) {
                  await button.scrollIntoViewIfNeeded()
                  await button.click()
                  await expect(button).toHaveAttribute('aria-pressed', 'true')
                  await assertDateVisible(button)
                  await assertBounds(card)
                }
              } else {
                await dates.focus()
                for (let index = 0; index < 5; index += 1) {
                  await page.keyboard.press('Tab')
                  await expect(buttons.nth(index)).toBeFocused()
                  await page.keyboard.press('Enter')
                  await expect(buttons.nth(index)).toHaveAttribute('aria-pressed', 'true')
                  await assertDateVisible(buttons.nth(index))
                }
              }
              await buttons.nth(2).click()
              await expect(card.getByText(populated ? 'Calendar meeting' : 'Nothing scheduled for this day.', { exact: true })).toBeVisible()
              const activateNavigation = async (name: string): Promise<void> => {
                const control = card.getByRole('button', { name, exact: true })
                if (inputMode === 'keyboard') {
                  await control.focus()
                  await page.keyboard.press('Enter')
                } else if (width === 390) {
                  await control.tap()
                } else {
                  await control.click()
                }
              }
              await activateNavigation('Next days')
              await expect(buttons.first()).not.toHaveAttribute('aria-label', initialNames[0]!)
              await activateNavigation('Previous days')
              await expect(buttons.first()).toHaveAttribute('aria-label', initialNames[0]!)
              await activateNavigation('Next month')
              await expect(dates).toHaveAccessibleName('December 2026')
              await activateNavigation('Previous month')
              await expect(dates).toHaveAccessibleName('November 2026')
              await expect(buttons).toHaveCount(5)
              await assertBounds(card)
            })
          })
        }
      })
    }
  }

  test(`TC-CRM-8603 ${kind} preserves completed activity local date when editing or canceling`, async ({ page, calendarAccount }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await withCalendar(page, calendarAccount, kind, true, async ({ card, dates, entityId, interactionId, token }) => {
      await card.getByText('Calendar meeting', { exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Edit activity' })
      await expect(dialog.getByRole('button', { name: 'Nov 4, 2026', exact: true })).toBeVisible()
      await expect(dialog.getByRole('button', { name: '12:30 AM', exact: true })).toBeVisible()
      await dialog.getByRole('textbox', { name: 'Activity title...' }).fill('Calendar updated')
      await dialog.getByRole('button', { name: 'Update activity', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect(card.getByText('Calendar updated', { exact: true })).toBeVisible()
      await expect(dates.getByRole('button', { name: 'WED 04' })).toHaveAttribute('aria-pressed', 'true')
      await card.getByText('Calendar updated', { exact: true }).click()
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
      await assertBounds(card)
    })
  })

  for (const concurrentEdit of [false, true]) {
    test(`TC-CRM-8730 ${kind} preserves untouched activity fields${concurrentEdit ? ' after a stale edit and retry' : ''}`, async ({ page, calendarAccount }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await withCalendar(page, calendarAccount, kind, true, async ({ card, entityId, interactionId, token }) => {
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
        await card.getByText('Calendar meeting', { exact: true }).click()
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
          await page.getByRole('tab', { name: kind === 'companies' ? /^Activity log(?: \d+)?$/ : 'Activity', exact: true }).click()
          await card.getByText('Concurrent title', { exact: true }).click()
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
