import { expect, sections, test } from './helpers/fixtures'

test('a session that is no longer available returns direct page requests to login', async ({ page, logistics }) => {
  expect(logistics.organizationId).toBeTruthy()
  await page.context().clearCookies({ name: /^(auth_token|session_token)$/ })
  for (const section of sections) {
    await page.goto(section.path)
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await expect(page.getByTestId('logistics-page')).toHaveCount(0)
  }
})
