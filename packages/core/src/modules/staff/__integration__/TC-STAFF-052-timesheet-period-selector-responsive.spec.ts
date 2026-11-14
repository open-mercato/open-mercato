import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import { createRoleFixture, createUserFixture, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['auth'] }

const translations = {
  en: {
    period: 'Period', previous: 'Previous period', next: 'Next period', today: 'Today',
    kinds: ['Week', 'Month', 'Quarter', 'Year'],
    labels: [
      ['Dec 28 – Jan 3, 2027 · W53', 'Dec 21 – Dec 27, 2026 · W52', 'Jan 4 – Jan 10, 2027 · W1'],
      ['December 2026', 'November 2026', 'January 2027'],
      ['Q4 2026', 'Q3 2026', 'Q1 2027'],
      ['2026', '2025', '2027'],
    ],
  },
  pl: {
    period: 'Okres', previous: 'Poprzedni okres', next: 'Następny okres', today: 'Dziś',
    kinds: ['Tydzień', 'Miesiąc', 'Kwartał', 'Rok'],
    labels: [
      ['28 gru – 3 sty 2027 · W53', '21 gru – 27 gru 2026 · W52', '4 sty – 10 sty 2027 · W1'],
      ['Grudzień 2026', 'Listopad 2026', 'Styczeń 2027'],
      ['Q4 2026', 'Q3 2026', 'Q1 2027'],
      ['2026', '2025', '2027'],
    ],
  },
} as const

async function expectContained(page: Page, controls: Locator[]): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  const viewport = page.viewportSize()!
  for (const control of controls) {
    await expect(control).toBeVisible()
    await expect(control).toBeEnabled()
    const bounds = await control.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1)
    await control.click({ trial: true })
  }
}

for (const language of ['en', 'pl'] as const) {
  for (const width of [375, 640, 1440]) {
    test(`TC-STAFF-052: ${language} period selector at ${width}px`, async ({ browser, request, baseURL }, testInfo) => {
      const adminToken = await getAuthToken(request, 'admin')
      const { tenantId, organizationId } = getTokenContext(adminToken)
      const suffix = randomUUID()
      const email = `qa-period-${suffix}@example.com`
      const password = `QA-${randomUUID()}!aA1`
      const owned: Array<{ path: string; id: string }> = []
      const context = await browser.newContext({ baseURL, viewport: { width, height: 1000 }, timezoneId: 'UTC', locale: language === 'pl' ? 'pl-PL' : 'en-US' })
      const page = await context.newPage()
      const copy = translations[language]
      const failedReads: string[] = []
      page.on('response', (response) => {
        if (new URL(response.url()).pathname.startsWith('/api/staff/') && response.request().method() === 'GET' && !response.ok()) {
          failedReads.push(`${new URL(response.url()).pathname}: ${response.status()}`)
        }
      })
      const waitForEntries = () => page.waitForResponse((response) => new URL(response.url()).pathname === '/api/staff/timesheets/time-entries')
      const changePeriod = async (control: Locator, expectedLabel: string) => {
        const entries = waitForEntries()
        await control.click()
        expect((await entries).status(), 'The selected period must load real timesheet data').toBe(200)
        await expect(page.getByTitle(expectedLabel, { exact: true })).toHaveText(expectedLabel)
      }
      try {
        const roleId = await createRoleFixture(request, adminToken, { name: `qa-period-${suffix}`, tenantId })
        owned.unshift({ path: '/api/auth/roles', id: roleId })
        await setRoleAclFeatures(request, adminToken, {
          roleId, organizations: [organizationId], features: ['staff.timesheets.view', 'staff.timesheets.manage_own', 'staff.timesheets.tasks.view', 'staff.leave_requests.send'],
        })
        const userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [roleId] })
        owned.unshift({ path: '/api/auth/users', id: userId })
        const profile = await apiRequest(request, 'POST', '/api/staff/team-members', {
          token: adminToken, data: { displayName: `QA Period ${suffix}`, userId },
        })
        expect(profile.status()).toBe(201)
        const memberId = expectId((await readJsonSafe<{ id?: string }>(profile))?.id, 'Team Member fixture id')
        owned.unshift({ path: '/api/staff/team-members', id: memberId })

        await getAuthToken(page.request, email, password)
        await context.addCookies([
          { name: 'locale', value: language, url: baseURL! },
          { name: 'om_selected_tenant', value: tenantId, url: baseURL! },
          { name: 'om_selected_org', value: organizationId, url: baseURL! },
        ])
        await acknowledgeGlobalNotices(page)
        await page.clock.setFixedTime(new Date('2026-12-30T12:00:00Z'))
        const initialEntries = waitForEntries()
        await page.goto('/backend/staff/time-tracking/timesheet?period=week')
        expect((await initialEntries).status()).toBe(200)
        const selector = page.getByRole('radiogroup', { name: copy.period, exact: true })
        await expect(selector).toBeVisible()
        const previous = page.getByRole('button', { name: copy.previous, exact: true })
        const next = page.getByRole('button', { name: copy.next, exact: true })
        const today = page.getByRole('button', { name: copy.today, exact: true })
        for (const [index, kind] of copy.kinds.entries()) {
          const [currentLabel, previousLabel, nextLabel] = copy.labels[index]
          const radio = selector.getByRole('radio', { name: kind, exact: true })
          if (index === 0) await radio.click()
          else await changePeriod(radio, currentLabel)
          await expect(radio).toBeChecked()
          const label = page.getByTitle(currentLabel, { exact: true })
          await expect(label).toHaveText(currentLabel)
          await expectContained(page, [previous, next, today])
          await changePeriod(previous, previousLabel)
          const longWeekLabel = page.getByTitle(previousLabel, { exact: true })
          await expect(longWeekLabel).toBeVisible()
          await expectContained(page, [previous, next, today])
          if (index === 0) {
            const metrics = await longWeekLabel.evaluate((element) => ({
              title: element.getAttribute('title'), text: element.textContent,
              clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
              overflow: getComputedStyle(element).textOverflow,
            }))
            expect(metrics.title).toBe(previousLabel)
            expect(metrics.text).toBe(previousLabel)
            expect(metrics.overflow).toBe('ellipsis')
            if (width === 375) expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth)
            await testInfo.attach(`week-${language}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
          }
          await changePeriod(next, currentLabel)
          await expect(label).toBeVisible()
          await changePeriod(next, nextLabel)
          await expect(page.getByTitle(nextLabel, { exact: true })).toBeVisible()
          await expectContained(page, [previous, next, today])
          await changePeriod(today, currentLabel)
          await expect(label).toBeVisible()
        }
        expect(failedReads, 'The owned Team Member must load the page without staff API errors').toEqual([])
      } finally {
        const cleanupErrors: string[] = []
        try {
          await context.close()
        } catch (error) {
          cleanupErrors.push(String(error))
        }
        for (const record of owned) {
          try {
            const response = await apiRequest(request, 'DELETE', `${record.path}?id=${encodeURIComponent(record.id)}`, { token: adminToken })
            if (!response.ok() && response.status() !== 404) cleanupErrors.push(`${record.path}: ${response.status()}`)
          } catch (error) {
            cleanupErrors.push(String(error))
          }
        }
        expect(cleanupErrors, 'Every owned staff profile, user and role must be removed').toEqual([])
      }
    })
  }
}
