import { expect, expectPlannedPage, sections, test } from './helpers/fixtures'

export const integrationMeta = { dependsOnModules: ['customers'] }

test('an independently granted Customers menu remains usable after logistics navigation', async ({ page, logistics }) => {
  await logistics.grant(['customers.people.view'], [logistics.organizationId], true)
  await page.goto(sections[0].path)
  await expectPlannedPage(page, sections[0])
  const sidebar = page.getByTestId('sidebar')
  const peopleLink = sidebar.getByRole('link', { name: 'People', exact: true })
  await expect(peopleLink).toBeVisible()
  await expect(peopleLink).toHaveAttribute('href', '/backend/customers/people')
  await peopleLink.click()
  await expect(page).toHaveURL('/backend/customers/people')
  await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible()
  await sidebar.getByRole('link', { name: sections[0].title, exact: true }).click()
  await expectPlannedPage(page, sections[0])
  await page.reload()
  await expect(peopleLink).toBeVisible()
  await peopleLink.click()
  await expect(page).toHaveURL('/backend/customers/people')
  await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible()
})
