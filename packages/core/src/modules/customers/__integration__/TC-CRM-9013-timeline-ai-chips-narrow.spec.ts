import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, createDealFixture, createPersonFixture, deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/crmFixtures'

const NARROW_VIEWPORT = { width: 390, height: 844 }
const CALL_CHIP_LABELS = {
  en: ['Summarize', 'Replay', 'Transcription', 'Action items'],
  pl: ['Podsumuj', 'Odtwórz', 'Transkrypcja', 'Zadania do wykonania'],
}

for (const locale of ['en', 'pl'] as const) {
  for (const kind of ['person', 'company', 'deal'] as const) {
    test(`TC-CRM-9013: ${locale} ${kind} Activities timeline keeps AI action chips inside a 390px viewport`, async ({ page, request, context, baseURL }) => {
      const token = await getAuthToken(request, 'admin')
      const stamp = `${Date.now()}-${kind}`
      const entityPath = kind === 'person' ? '/api/customers/people' : '/api/customers/companies'
      let entityId: string | null = null
      let interactionId: string | null = null
      let dealId: string | null = null
      try {
        entityId = kind === 'person'
          ? await createPersonFixture(request, token, { firstName: 'Narrow', lastName: stamp, displayName: `Narrow ${stamp}` })
          : await createCompanyFixture(request, token, `Narrow ${stamp}`)
        if (kind === 'deal') {
          dealId = await createDealFixture(request, token, { title: `Narrow deal ${stamp}`, companyIds: [entityId] })
        }
        const title = `Narrow call with a longer title to exercise timeline wrapping ${stamp}`
        const response = await apiRequest(request, 'POST', '/api/customers/interactions', {
          token,
          data: { entityId, ...(dealId ? { dealId } : {}), title, interactionType: 'call', status: 'done', occurredAt: new Date().toISOString(), scheduledAt: null },
        })
        expect(response.ok()).toBeTruthy()
        interactionId = (await readJsonSafe<{ id: string }>(response))?.id ?? null
        expect(interactionId).toBeTruthy()

        await page.setViewportSize(NARROW_VIEWPORT)
        await login(page, 'admin')
        await context.addCookies([{ name: 'locale', value: locale, url: baseURL! }])
        const detailPath = dealId ? `/backend/customers/deals/${dealId}` : `/backend/customers/${kind === 'person' ? 'people' : 'companies'}/${entityId}`
        await page.goto(`${detailPath}?tab=activities`)
        const activitiesTab = page.getByRole('tab', { name: locale === 'en' ? 'Activities' : 'Aktywności', exact: true })
        if (await activitiesTab.count()) await activitiesTab.click()
        await expect(page.getByText(title, { exact: true })).toBeVisible()

        const entry = page.getByText(title, { exact: true }).locator('xpath=ancestor::div[contains(@class,"py-2.5")][1]')
        for (const label of CALL_CHIP_LABELS[locale]) {
          const chip = entry.getByRole('button', { name: label, exact: true })
          await expect(chip).toBeVisible()
          const box = await chip.boundingBox()
          expect(box, `${label} chip has no layout box`).not.toBeNull()
          expect(box!.x, `${label} chip starts outside the viewport`).toBeGreaterThanOrEqual(0)
          expect(box!.x + box!.width, `${label} chip ends outside the viewport`).toBeLessThanOrEqual(NARROW_VIEWPORT.width)
        }
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
        expect(scrollWidth).toBeLessThanOrEqual(NARROW_VIEWPORT.width)
        await page.screenshot({ path: test.info().outputPath(`${locale}-${kind}-timeline-ai-chips-390.png`), fullPage: true })
        await page.setViewportSize({ width: 1440, height: 1000 })
        for (const label of CALL_CHIP_LABELS[locale]) {
          await expect(entry.getByRole('button', { name: label, exact: true })).toBeInViewport()
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
        await page.screenshot({ path: test.info().outputPath(`${locale}-${kind}-timeline-ai-chips-desktop.png`), fullPage: true })
      } finally {
        await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
        await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
        await deleteEntityIfExists(request, token, entityPath, entityId)
      }
    })
  }
}
