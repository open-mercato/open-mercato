import { expect, expectAccessDenied, expectPlannedPage, sections, test } from './helpers/fixtures'

test('organization switching uses the selected organization and current role grant', async ({ page, logistics }) => {
  const secondOrganization = await logistics.addOrganization()
  await logistics.grant([], [logistics.organizationId, secondOrganization.id], true)
  await page.goto(sections[0].path)
  await expectPlannedPage(page, sections[0])
  await page.getByRole('button', { name: `Organization: ${logistics.organizationName}`, exact: true }).click()
  await page.getByRole('button', { name: secondOrganization.name, exact: true }).click()
  await expect.poll(async () => (await page.context().cookies()).find((cookie) => cookie.name === 'om_selected_org')?.value).toBe(secondOrganization.id)
  await expectAccessDenied(page)
  await logistics.grant(['logistics.view'], [logistics.organizationId, secondOrganization.id])
  await page.reload()
  await expectPlannedPage(page, sections[0])
  await expect(page.getByRole('button', { name: `Organization: ${secondOrganization.name}`, exact: true })).toBeVisible()
  await logistics.grant(['logistics.view'], [logistics.organizationId])
  await page.reload()
  await expectAccessDenied(page)
})

test('an inaccessible organization is absent from the switcher and a spoofed selection cannot grant access', async ({ page, logistics, baseURL }) => {
  const accessibleOrganization = await logistics.addOrganization()
  const inaccessibleOrganization = await logistics.addOrganization()
  await logistics.grant([], [logistics.organizationId, accessibleOrganization.id], true)
  await page.goto(sections[0].path)
  await expectPlannedPage(page, sections[0])
  const switcher = page.getByRole('button', { name: `Organization: ${logistics.organizationName}`, exact: true })
  await switcher.click()
  await expect(page.getByRole('button', { name: accessibleOrganization.name, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: inaccessibleOrganization.name, exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')

  const spoofSelection = async () => {
    await page.context().addCookies([{
      name: 'om_selected_org',
      value: inaccessibleOrganization.id,
      url: baseURL!,
      sameSite: 'Lax',
    }])
  }
  await spoofSelection()
  await page.reload()
  await expectPlannedPage(page, sections[0])
  await expect(switcher).toBeVisible()
  await expect.poll(async () => (await page.context().cookies()).find((cookie) => cookie.name === 'om_selected_org')?.value).toBe(logistics.organizationId)

  await logistics.grant([])
  await spoofSelection()
  await page.reload()
  await expectAccessDenied(page)
})
