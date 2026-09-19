import { expect, sections, test } from './helpers/fixtures'

const polishTitles = [
  'Pulpit dyspozytora',
  'Zlecenia transportowe',
  'Pojazdy / kierowcy',
  'Przejazdy i trasy',
  'Mapa floty',
  'Statystyki',
  'Propozycje i zakłócenia',
]

test('Polish logistics pages and the seven ordered navigation entries are translated', async ({ page, logistics, baseURL }) => {
  expect(logistics.organizationId).toBeTruthy()
  await page.context().addCookies([{ name: 'locale', value: 'pl', url: baseURL!, sameSite: 'Lax' }])
  for (const [index, section] of sections.entries()) {
    await page.goto(section.path)
    const content = page.getByTestId('logistics-page')
    await expect(content.getByRole('heading', { name: polishTitles[index], exact: true })).toBeVisible()
    await expect(content.getByText('Funkcja planowana', { exact: true })).toBeVisible()
  }
  const sidebar = page.getByTestId('sidebar')
  await expect(sidebar.getByRole('button', { name: 'Logistyka', exact: true })).toHaveCount(1)
  const logisticsLinks = sidebar.getByRole('link').filter({ hasText: new RegExp(`^(${polishTitles.join('|')})$`) })
  await expect(logisticsLinks).toHaveText(polishTitles)
})
