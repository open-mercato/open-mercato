import assert from 'node:assert/strict'
import path from 'node:path'
import { expect } from '@playwright/test'

export async function checkSourceSelectionCards(page, render, artifacts) {
  const checks = []
  for (const theme of ['light', 'dark']) {
    const globals = `theme:${theme};font:application`
    for (const control of ['checkbox', 'radio', 'switch']) {
      for (const kind of ['icon', 'avatar', 'provider', 'brand', 'company']) {
        await render(page, `primitives-inputs-${control}-field--variant-source-cards-${kind}`, globals)
        const cards = page.locator('[data-slot="selection-source-card"]')
        await expect(cards).toHaveCount(3)
        for (const card of await cards.all()) {
          const bounds = await card.boundingBox()
          assert.equal(bounds.width, 360)
          assert.equal(bounds.height, 72)
          assert.equal(await card.evaluate(node => getComputedStyle(node).borderRadius), '12px')
          const visual = card.locator('img')
          await expect(visual).toHaveJSProperty('complete', true)
          assert.ok(await visual.evaluate(node => node.naturalWidth > 0))
          assert.equal((await visual.boundingBox()).width, kind === 'provider' ? 32 : 40)
        }
        const first = cards.nth(0).getByRole(control)
        const active = cards.nth(1).getByRole(control)
        const disabled = cards.nth(2).getByRole(control)
        await expect(first).toHaveAttribute('aria-checked', 'false')
        await expect(active).toHaveAttribute('aria-checked', 'true')
        await expect(disabled).toBeDisabled()
        const disabledValue = await disabled.getAttribute('aria-checked')
        await cards.nth(2).click({ position: { x: 8, y: 8 } })
        await expect(disabled).toHaveAttribute('aria-checked', disabledValue)
        const background = await cards.nth(0).evaluate(node => getComputedStyle(node).backgroundColor)
        await cards.nth(0).hover()
        await expect.poll(() => cards.nth(0).evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(background)
        await cards.nth(0).click({ position: { x: 8, y: 8 } })
        await expect(first).toHaveAttribute('aria-checked', 'true')
        if (control === 'radio') {
          await expect(active).toHaveAttribute('aria-checked', 'false')
          await first.focus()
          await first.press('ArrowDown', { delay: 50 })
          await expect(active).toHaveAttribute('aria-checked', 'true')
          await expect(active).toBeFocused()
          await expect(first).toHaveAttribute('aria-checked', 'false')
        } else {
          await first.focus()
          await first.press('Space')
          await expect(first).toHaveAttribute('aria-checked', 'false')
        }
        if (artifacts && kind === 'company') await page.screenshot({ animations: 'disabled', path: path.join(artifacts, `selection-source-${control}-${theme}.png`) })
      }
      checks.push(`${control} icon/avatar/provider/brand/company cards match 360×72 and support whole-card click, hover, keyboard and disabled states in ${theme}`)
    }
    for (const alignment of ['horizontal', 'vertical']) {
      for (const appearance of ['card', 'list']) {
        await render(page, `primitives-inputs-switch-field--variant-integration-${alignment}-${appearance}`, globals)
        const integration = page.locator('[data-slot="integration-switch"]')
        const bounds = await integration.boundingBox()
        assert.equal(bounds.width, alignment === 'horizontal' ? 616 : 380)
        assert.equal(bounds.height, alignment === 'horizontal' ? appearance === 'card' ? 72 : 48 : appearance === 'card' ? 176 : 160)
        const toggle = integration.getByRole('switch')
        await toggle.focus()
        await toggle.press('Space')
        await expect(toggle).toHaveAttribute('aria-checked', 'true')
        const manage = page.getByRole('button', { name: 'Manage', exact: true })
        await manage.click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        await dialog.getByRole('switch').click()
        await page.keyboard.press('Control+Enter')
        await expect(dialog).toHaveCount(0)
        await expect(toggle).toHaveAttribute('aria-checked', 'false')
        await expect(manage).toBeFocused()
        await manage.click()
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        if (artifacts && alignment === 'vertical') await page.screenshot({ animations: 'disabled', path: path.join(artifacts, `integration-${appearance}-${theme}.png`) })
      }
    }
    checks.push(`All four IntegrationSwitch compositions support keyboard toggling, Manage settings, Ctrl+Enter and Escape in ${theme}`)
  }
  const viewport = page.viewportSize()
  await page.setViewportSize({ width: 390, height: 844 })
  for (const variant of ['source-cards-company', 'integration-horizontal-card', 'integration-vertical-list']) {
    await render(page, `primitives-inputs-switch-field--variant-${variant}`, 'theme:dark;font:application')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${variant} mobile overflow`)
    if (artifacts) await page.screenshot({ animations: 'disabled', path: path.join(artifacts, `selection-mobile-${variant}.png`) })
  }
  if (viewport) await page.setViewportSize(viewport)
  checks.push('Source selection cards and integration compositions stay within 390px')
  return checks
}
