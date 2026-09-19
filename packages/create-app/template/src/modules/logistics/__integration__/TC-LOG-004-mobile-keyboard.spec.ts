import { expect, expectPlannedPage, sections, test } from './helpers/fixtures'

test('the standard mobile menu and keyboard links reach every logistics section', async ({ page, logistics }) => {
  expect(logistics.organizationId).toBeTruthy()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(sections[0].path)
  for (const section of sections) {
    const openMenu = page.getByRole('button', { name: 'Open menu', exact: true })
    await openMenu.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Close menu', exact: true })).toBeVisible()
    const link = page.getByRole('complementary').filter({ has: page.getByRole('button', { name: 'Close menu', exact: true }) }).getByRole('link', { name: section.title, exact: true })
    await link.focus()
    await expect(link).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(section.path)
    await expectPlannedPage(page, section)
    await expect(page.getByRole('button', { name: 'Close menu', exact: true })).toHaveCount(0)
  }
})
