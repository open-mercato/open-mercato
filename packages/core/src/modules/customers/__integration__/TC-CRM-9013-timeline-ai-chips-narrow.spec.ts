import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'

const NARROW_VIEWPORT = { width: 390, height: 844 }

type Locale = 'en' | 'pl'
type Mount = 'person' | 'company' | 'deal'

const CALL_CHIP_LABELS: Record<Locale, string[]> = {
  en: ['Summarize', 'Replay', 'Transcription', 'Action items'],
  pl: ['Podsumuj', 'Odtwórz', 'Transkrypcja', 'Zadania do wykonania'],
}
const ACTIVITIES_TAB_LABEL: Record<Locale, RegExp> = {
  en: /^Activities$/i,
  pl: /^Aktywności$/i,
}

const CASES: Array<{ mount: Mount; locale: Locale; longTitle: boolean }> = [
  { mount: 'person', locale: 'en', longTitle: false },
  { mount: 'company', locale: 'en', longTitle: false },
  { mount: 'deal', locale: 'en', longTitle: false },
  { mount: 'deal', locale: 'pl', longTitle: true },
]

async function switchLocale(page: Page, locale: Locale): Promise<boolean> {
  const response = await page.request.post('/api/auth/locale', { data: { locale } })
  if (response.status() === 409) return false
  expect(response.ok(), `POST /api/auth/locale "${locale}" returned ${response.status()}`).toBeTruthy()
  return true
}

for (const { mount, locale, longTitle } of CASES) {
  test(`TC-CRM-9013: ${mount} Activities timeline keeps AI action chips inside a 390px viewport (${locale}${longTitle ? ', long title' : ''})`, async ({ page, request }) => {
    test.setTimeout(90_000)
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${mount}-${locale}`
    let ownerId: string | null = null
    let dealId: string | null = null
    let interactionId: string | null = null
    let localeSwitched = false
    try {
      ownerId = mount === 'person'
        ? await createPersonFixture(request, token, { firstName: 'Narrow', lastName: stamp, displayName: `Narrow ${stamp}` })
        : await createCompanyFixture(request, token, `Narrow ${stamp}`)
      if (mount === 'deal') {
        dealId = await createDealFixture(request, token, { title: `Narrow deal ${stamp}`, companyIds: [ownerId] })
      }
      const title = longTitle
        ? `Rozmowa kwalifikacyjna z zespołem zakupowym w sprawie przedłużenia umowy serwisowej ${stamp}`
        : `Narrow call ${stamp}`
      const response = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: ownerId,
          ...(dealId ? { dealId } : {}),
          title,
          interactionType: 'call',
          status: 'done',
          occurredAt: new Date().toISOString(),
          scheduledAt: null,
        },
      })
      expect(response.ok()).toBeTruthy()
      interactionId = (await readJsonSafe<{ id: string }>(response))?.id ?? null
      expect(interactionId).toBeTruthy()

      await page.setViewportSize(NARROW_VIEWPORT)
      await login(page, 'admin')
      if (locale !== 'en') {
        localeSwitched = await switchLocale(page, locale)
        test.skip(!localeSwitched, 'Locale is pinned via OM_FORCE_LOCALE in this environment')
      }
      const detailPath = mount === 'person'
        ? `/backend/customers/people/${ownerId}`
        : mount === 'company'
          ? `/backend/customers/companies/${ownerId}`
          : `/backend/customers/deals/${dealId}`
      await page.goto(`${detailPath}?tab=activities`)
      const activitiesTab = page.getByRole('tab', { name: ACTIVITIES_TAB_LABEL[locale] })
      if (await activitiesTab.count()) await activitiesTab.first().click()
      await expect(page.getByText(title, { exact: true })).toBeVisible()

      const entry = page.getByText(title, { exact: true }).locator('xpath=ancestor::div[contains(@class,"py-2.5")][1]')
      for (const label of CALL_CHIP_LABELS[locale]) {
        const chip = entry.getByRole('button', { name: label, exact: true })
        await expect(chip).toBeVisible()
        const box = await chip.boundingBox()
        expect(box, `${label} chip has no layout box`).not.toBeNull()
        expect(box!.x + box!.width, `${label} chip ends outside the viewport`).toBeLessThanOrEqual(NARROW_VIEWPORT.width)
      }
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
      expect(scrollWidth).toBeLessThanOrEqual(NARROW_VIEWPORT.width)
      await page.screenshot({ path: test.info().outputPath(`${mount}-${locale}-timeline-ai-chips-390.png`), fullPage: true })
    } finally {
      if (localeSwitched) await page.request.post('/api/auth/locale', { data: { locale: 'en' } }).catch(() => undefined)
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
      await deleteEntityIfExists(request, token, mount === 'person' ? '/api/customers/people' : '/api/customers/companies', ownerId)
    }
  })
}
