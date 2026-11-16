import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import type { MessagePriority } from '../lib/priorityUtils'
import { composeInternalMessage, deleteMessageIfExists } from './helpers'

/**
 * TC-MSG-PRIORITY-LOCALE-001: real-browser coverage for the `PriorityBadge`
 * (#9277, follow-up to #9166/#8800). The dictionary fix in #9166 only shipped
 * a unit test pinning the JSON literals — nothing renders `PriorityBadge` in
 * a browser, so a regression in the component's `t()` wiring (as opposed to
 * the dictionary itself) would go undetected. This spec composes one message
 * per priority, opens the real message detail page per supported locale, and
 * asserts the badge's accessible label/tooltip against the exact non-English
 * literal — not `getPriorityFallbackLabel`'s English string — so a key that
 * silently stops resolving (the #8514/#8800 failure mode) fails this
 * assertion instead of only failing a unit test against the same JSON file.
 */

const PRIORITIES: MessagePriority[] = ['low', 'normal', 'high', 'urgent']

const PRIORITY_TITLE_BY_LOCALE: Record<string, string> = {
  en: 'Priority',
  pl: 'Priorytet',
  de: 'Priorität',
  es: 'Prioridad',
  ko: '우선순위',
}

const PRIORITY_VALUE_BY_LOCALE: Record<string, Record<MessagePriority, string>> = {
  en: { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' },
  pl: { low: 'Niski', normal: 'Normalny', high: 'Wysoki', urgent: 'Pilny' },
  de: { low: 'Niedrig', normal: 'Normal', high: 'Hoch', urgent: 'Dringend' },
  es: { low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente' },
  ko: { low: '낮음', normal: '보통', high: '높음', urgent: '긴급' },
}

const LOCALES = Object.keys(PRIORITY_VALUE_BY_LOCALE)

function expectedLabel(locale: string, priority: MessagePriority): string {
  return `${PRIORITY_TITLE_BY_LOCALE[locale]}: ${PRIORITY_VALUE_BY_LOCALE[locale][priority]}`
}

async function setLocale(page: Page, locale: string): Promise<boolean> {
  const response = await page.request.post('/api/auth/locale', { data: { locale } })
  if (response.status() === 409) return false
  expect(response.ok(), `POST /api/auth/locale should accept "${locale}": ${response.status()}`).toBeTruthy()
  return true
}

async function expectViewportContained(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(0)
}

test.describe('TC-MSG-PRIORITY-LOCALE-001: PriorityBadge stays localized on the real message detail page', () => {
  for (const locale of LOCALES) {
    test(`renders the ${locale} accessible label and tooltip for every priority`, async ({ page, request }) => {
      // The first navigation in this file can pay a one-time Next.js dev-mode
      // compile tax for /backend/messages/[id]; size the timeout for that, not
      // just the warm-route ~20s seen on every subsequent locale.
      test.setTimeout(150_000)

      let senderToken: string | null = null
      const messageIdByPriority = new Map<MessagePriority, string>()
      let localeSwitched = false

      try {
        for (const priority of PRIORITIES) {
          const fixture = await composeInternalMessage(request, {
            subject: `QA priority-locale ${locale} ${priority} ${Date.now()}`,
            priority,
          })
          senderToken = fixture.senderToken
          messageIdByPriority.set(priority, fixture.messageId)
        }

        await login(page, 'admin')

        localeSwitched = await setLocale(page, locale)
        if (!localeSwitched) {
          test.skip(true, 'Locale is pinned via OM_FORCE_LOCALE in this environment; locale switching is disabled')
          return
        }

        for (const priority of PRIORITIES) {
          const messageId = messageIdByPriority.get(priority)
          await page.goto(`/backend/messages/${messageId}`, { waitUntil: 'domcontentloaded' })

          const expected = expectedLabel(locale, priority)
          const heading = page.getByRole('heading', { level: 1 })
          const badge = heading.locator(`[aria-label="${expected}"]`)
          await expect(badge, `priority=${priority} locale=${locale} should carry the localized aria-label`).toBeVisible()
          await expect(badge).toHaveAttribute('title', expected)

          await badge.hover()
          const tooltip = page.getByRole('tooltip')
          await expect(tooltip, `priority=${priority} locale=${locale} should render the localized tooltip text`).toBeVisible()
          await expect(tooltip).toHaveText(expected)
          await page.mouse.move(0, 0)
        }

        // Acceptance criterion: confirm the badge stays readable on a phone viewport.
        const mobilePriority: MessagePriority = 'urgent'
        const mobileMessageId = messageIdByPriority.get(mobilePriority)
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto(`/backend/messages/${mobileMessageId}`, { waitUntil: 'domcontentloaded' })
        const mobileExpected = expectedLabel(locale, mobilePriority)
        const mobileBadge = page.getByRole('heading', { level: 1 }).locator(`[aria-label="${mobileExpected}"]`)
        await expect(mobileBadge).toBeVisible()
        await expectViewportContained(page)
      } finally {
        if (senderToken) {
          for (const messageId of messageIdByPriority.values()) {
            await deleteMessageIfExists(request, senderToken, messageId)
          }
        }
        if (localeSwitched) {
          await page.request.post('/api/auth/locale', { data: { locale: 'en' } }).catch(() => {})
        }
      }
    })
  }
})
