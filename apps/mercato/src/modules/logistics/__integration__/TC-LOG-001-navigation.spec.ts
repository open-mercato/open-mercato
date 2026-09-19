import type { Request } from '@playwright/test'
import { expect, expectPlannedPage, sections, test } from './helpers/fixtures'

test.describe('Logistics page navigation', () => {
  for (const section of sections) {
    test(`${section.title} supports direct access, reload and its menu link`, async ({ page, logistics }) => {
      expect(logistics.organizationId).toBeTruthy()
      const logisticsApiRequests: string[] = []
      const captureLogisticsRequest = (request: Request) => {
        const pathname = new URL(request.url()).pathname
        if (/^\/api\/logistics(?:\/|$)/.test(pathname)) logisticsApiRequests.push(pathname)
      }
      page.on('request', captureLogisticsRequest)
      await page.goto(section.path)
      await expectPlannedPage(page, section)
      await page.reload()
      await expectPlannedPage(page, section)
      await expect(page.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'true')
      const sidebar = page.getByTestId('sidebar')
      const group = sidebar.getByRole('button', { name: 'Logistics', exact: true })
      await expect(group).toHaveAttribute('aria-expanded', 'true')
      const link = sidebar.getByRole('link', { name: section.title, exact: true })
      await expect(link).toHaveCount(1)
      await expect(link).toHaveAttribute('href', section.path)
      await expect(link).toHaveClass(/\bbg-muted\b/)
      await link.click()
      await expect(page).toHaveURL(section.path)
      await expectPlannedPage(page, section)
      expect(logisticsApiRequests, 'Static logistics navigation must not call a logistics API').toEqual([])
      page.off('request', captureLogisticsRequest)
    })
  }

  test('the dashboard has exactly six section links and every section links back', async ({ page, logistics }) => {
    expect(logistics.organizationId).toBeTruthy()
    await page.goto(sections[0].path)
    const content = page.getByTestId('logistics-page')
    const navigation = content.getByRole('navigation')
    await expect(navigation.getByRole('link')).toHaveCount(6)
    for (const section of sections.slice(1)) {
      const link = navigation.getByRole('link', { name: section.title, exact: true })
      await expect(link).toHaveAttribute('href', section.path)
      await link.click()
      await expectPlannedPage(page, section)
      await content.getByRole('link', { name: /dashboard/i }).click()
      await expectPlannedPage(page, sections[0])
    }
  })
})
