import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

test.use({ timezoneId: 'Europe/Warsaw', locale: 'en-US' })

test('Recently created stays editable after applying and reopening across the autumn DST boundary', async ({ page, request }, testInfo) => {
  const token = await getAuthToken(request, 'admin')
  const marker = `TCRecentPreset${Date.now()}`
  const includedName = `${marker} Included`
  const excludedName = `${marker} Excluded`
  const companyIds: string[] = []
  try {
    const includedId = await createCompanyFixture(request, token, includedName)
    companyIds.push(includedId)
    const excludedId = await createCompanyFixture(request, token, excludedName)
    companyIds.push(excludedId)
    await withClient(async (client) => {
      for (const [companyId, createdAt] of [
        [includedId, '2026-10-23T22:00:00.000Z'],
        [excludedId, '2026-10-23T21:59:59.999Z'],
      ]) {
        const result = await client.query('update customer_entities set created_at = $1 where id = $2', [createdAt, companyId])
        expect(result.rowCount).toBe(1)
      }
    })
    await login(page, 'admin')
    await page.clock.setFixedTime(new Date('2026-10-31T22:30:00.000Z'))
    await page.goto('/backend/customers/companies')
    await page.getByRole('searchbox', { name: 'Search by name, email, phone…' }).fill(marker)
    const includedRow = page.getByRole('row').filter({ hasText: includedName })
    const excludedRow = page.getByRole('row').filter({ hasText: excludedName })
    await expect(includedRow).toBeVisible()
    await expect(excludedRow).toBeVisible()

    const filtersButton = page.getByRole('button', { name: 'Advanced filters', exact: true })
    await filtersButton.click()
    await page.getByRole('button', { name: 'Recently created', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(includedRow).toBeVisible()
    await expect(excludedRow).toHaveCount(0)
    await expect.poll(() => new URL(page.url()).searchParams.get('filter[root][children][0][op]')).toBe('is_after')
    expect(new URL(page.url()).searchParams.get('filter[root][children][0][value]')).toBe('2026-10-23')

    await filtersButton.click()
    const operator = page.getByRole('combobox', { name: 'Select operator', exact: true })
    await expect(operator).toHaveText('is after')
    await expect(page.getByRole('textbox', { name: 'Date value', exact: true })).toHaveValue('2026-10-23')
    await testInfo.attach('recent-preset-reopened', { body: await page.screenshot(), contentType: 'image/png' })
    await operator.click()
    await page.getByRole('option', { name: 'is after', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.reload()
    await expect(includedRow).toBeVisible()
    await expect(excludedRow).toHaveCount(0)
    await filtersButton.click()
    await expect(operator).toHaveText('is after')
    await expect(page.getByRole('textbox', { name: 'Date value', exact: true })).toHaveValue('2026-10-23')
  } finally {
    for (const companyId of companyIds) {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  }
})
