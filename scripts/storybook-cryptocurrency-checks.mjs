import fs from 'node:fs'
import { expect } from '@playwright/test'
import { storyNameFromExport, toId } from 'storybook/internal/csf'

const coverage = JSON.parse(
  fs.readFileSync(new URL('../docs/design-system/figma-audit/cryptocurrency-coverage.json', import.meta.url), 'utf8'),
)
export const cryptocurrencyVariants = coverage.examples.map((row) => row.id)

export async function checkCryptocurrency(page, render, artifacts, themes = ['light', 'dark']) {
  const measurements = []
  const renderVariant = (id, theme) => {
    const exportName = `Variant${id.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('')}`
    return render(page, toId('backend-scaffolding-cryptocurrency', storyNameFromExport(exportName)), `theme:${theme};font:figma`)
  }
  for (const theme of themes) {
    await page.setViewportSize({ width: 1500, height: 1100 })
    for (const row of coverage.examples) {
      await renderVariant(row.id, theme)
      const demo = page.locator('[data-slot="crypto-demo"]')
      await expect(demo).toBeVisible()
      const result = await demo.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
        overflowX: element.scrollWidth - element.clientWidth,
        brokenImages: [...element.querySelectorAll('img')].filter((img) => img.complete && img.naturalWidth === 0)
          .length,
        unresolved: element.innerText.includes('design_system.gallery.samples.crypto.'),
      }))
      expect(result.overflowX, row.id).toBeLessThanOrEqual(1)
      expect(result.brokenImages, row.id).toBe(0)
      expect(result.unresolved, row.id).toBe(false)
      if (row.height) expect(Math.abs(result.height - row.height), `${row.id} source height`).toBeLessThanOrEqual(1)
      measurements.push({ id: row.id, theme, ...result, sourceWidth: row.width, sourceHeight: row.height })
      if (
        [
          'swap-3',
          'search-modal-default',
          'favorites-dropdown',
          'wallet-dropdown',
          'connect-wallet',
          'filter-token',
          'navigation-true',
        ].includes(row.id)
      )
        await demo.screenshot({ path: `${artifacts}/crypto-${row.id}-${theme}.png` })
    }
    await renderVariant('swap-1', theme)
    const selling = page.getByRole('textbox', { name: 'You are selling', exact: true })
    await selling.fill('1')
    await expect(page.getByRole('button', { name: 'Enter amount', exact: true })).toBeDisabled()
    await selling.fill('0.005')
    await page.getByRole('button', { name: 'Get demo quote', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'You will receive', exact: true })).toHaveValue('581.18')
    await selling.press('Control+Enter')
    await expect(page.getByRole('button', { name: 'Demo swap confirmed', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Reverse token pair', exact: true }).click()
    await expect(selling).toHaveValue('')
    await renderVariant('search-modal-default', theme)
    await page.getByRole('combobox').fill('Ethereum')
    await expect(page.getByRole('option')).toHaveCount(4)
    await page.getByRole('combobox').press('ArrowDown')
    await page.getByRole('combobox').press('Enter')
    await expect(page.getByRole('status')).toBeVisible()
    await page.getByRole('combobox').fill('not-a-listed-coin')
    await expect(page.getByText('No matching tokens', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Clear search', exact: true }).click()
    await expect(page.getByRole('option')).toHaveCount(10)
    await renderVariant('swap-select-lighter-default', theme)
    await page.getByRole('button', { name: 'Select token', exact: true }).click()
    await page.getByRole('searchbox').fill('Solana')
    await page.getByRole('button', { name: 'Solana', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Select token', exact: true })).toContainText('SOL')
    await renderVariant('table-filter-type-default', theme)
    await page.getByRole('button', { name: 'Filter by Type', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Swap', exact: true }).check()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Filter by Type', exact: true })).toContainText('Swap')
    await renderVariant('favorites-dropdown', theme)
    await page.getByRole('searchbox').fill('Ethereum')
    await page.getByRole('button', { name: 'Remove Ethereum from favorites', exact: true }).click()
    await expect(page.getByText('My favorites (3)', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(page.getByText('My favorites (0)', { exact: true })).toBeVisible()
    await renderVariant('connect-wallet', theme)
    await page.getByRole('button', { name: 'Connect Phantom', exact: true }).click()
    await expect(page.getByText('Wallet connected', { exact: true })).toBeVisible()
    await renderVariant('navigation-search-default', theme)
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.setViewportSize({ width: 375, height: 950 })
    for (const id of [
      'swap-1',
      'swap-3',
      'search-modal-default',
      'search-modal-empty',
      'favorites-dropdown',
      'profile-dropdown',
      'wallet-dropdown',
      'filter-token',
      'notifications-dropdown',
      'connect-wallet',
      'mobile-navigation',
      'mobile-bottom-navigation',
    ]) {
      await renderVariant(id, theme)
      const demo = page.locator('[data-slot="crypto-demo"]')
      expect(await demo.evaluate((el) => el.scrollWidth - el.clientWidth), `${id} mobile`).toBeLessThanOrEqual(1)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        `${id} document mobile`,
      ).toBeLessThanOrEqual(1)
      await demo.screenshot({ path: `${artifacts}/crypto-${id}-mobile-${theme}.png` })
    }
  }
  return measurements
}
