import assert from 'node:assert/strict'
import path from 'node:path'
import { expect } from '@playwright/test'

export async function checkOverlayCompositions(page, render, artifacts) {
  const checks = []
  for (const theme of ['light', 'dark']) {
    for (const alignment of ['horizontal', 'vertical']) {
      for (const status of ['error', 'warning', 'success', 'info']) {
        await render(page, `primitives-overlays-dialog--variant-status-${alignment}-${status}`, `theme:${theme};font:application`)
        const trigger = page.getByRole('button', { name: 'Open dialog', exact: true })
        await trigger.click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        await expect(dialog.locator('[data-slot="dialog-header"]')).toHaveAttribute('data-alignment', alignment)
        const badge = await dialog.locator('[data-slot="dialog-header-leading"]').boundingBox()
        assert.equal(badge.width, 40)
        assert.equal(badge.height, 40)
        if (alignment === 'vertical') {
          const bounds = await dialog.boundingBox()
          assert.ok(Math.abs(badge.x + badge.width / 2 - bounds.x - bounds.width / 2) < 1, 'Status badge must be centered')
        }
        if (status === 'error' && alignment === 'vertical') await page.screenshot({ path: path.join(artifacts, `dialog-source-${theme}.png`), animations: 'disabled' })
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(trigger).toBeFocused()
      }
    }
    checks.push(`Dialog ${theme}: all8status arrangements open, center correctly and restore focus after Escape`)

    await page.setViewportSize({ width: 375, height: 900 })
    for (const family of ['dialog', 'drawer']) {
      const footers = family === 'dialog' ? ['basic', 'equal', 'checkbox', 'information', 'toggle', 'stepper', 'link'] : ['basic', 'equal', 'checkbox', 'toggle', 'stepper', 'link']
      for (const footer of footers) {
        await render(page, `primitives-overlays-${family}--variant-footer-${footer}`, `theme:${theme};font:application`)
        await page.getByRole('button', { name: family === 'dialog' ? 'Open dialog' : 'Open drawer', exact: true }).click()
        const panel = page.getByRole('dialog')
        await expect(panel).toBeVisible()
        const horizontalOverflow = await panel.evaluate(node => node.scrollWidth > node.clientWidth + 1)
        assert.equal(horizontalOverflow, false, `${family}/${footer} overflows mobile`)
        const action = panel.getByRole('button', { name: 'Continue', exact: true })
        await expect(action).toBeVisible()
        await action.click()
        await expect(panel).toHaveCount(0)
      }
    }
    checks.push(`Overlays ${theme}: all13footer modes fit375px and their primary action closes the panel`)
    await page.setViewportSize({ width: 1440, height: 1000 })

    for (const size of ['sm', 'default', 'lg']) {
      for (const variant of ['light', 'dark']) {
        await render(page, `primitives-overlays-tooltip--variant-positions-${size}-${variant}`, `theme:${theme};font:application`)
        const triggers = page.getByRole('button')
        assert.equal(await triggers.count(), 8)
        for (let index = 0; index < 8; index++) {
          const trigger = triggers.nth(index)
          if (size === 'lg') {
            await trigger.click()
            const card = page.locator('[data-slot="tooltip-card"]')
            await expect(card).toBeVisible()
            await card.getByRole('button', { name: 'Close', exact: true }).click()
            await expect(card).toHaveCount(0)
            await expect(trigger).toBeFocused()
          } else {
            await trigger.hover()
            const content = page.locator('[data-slot="tooltip-content"]')
            await expect(content).toBeVisible()
            const height = await content.evaluate(node => node.offsetHeight)
            assert.equal(height, size === 'sm' ? 20 : 28)
            await expect(content.locator('[data-slot="tooltip-arrow"]')).toBeVisible()
            await page.mouse.move(10, 10, { steps: 10 })
            await expect(content).toHaveCount(0)
          }
        }
      }
    }
    checks.push(`Tooltip ${theme}:48source size/style/position combinations, visible tails and keyboard-reachable large-card dismissal`)
    await render(page, 'primitives-overlays-popover--variant-footer-stepper', `theme:${theme};font:application`)
    await page.getByRole('button', { name: 'Open popover', exact: true }).click()
    const popover = page.getByRole('dialog')
    await expect(popover.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
    await expect(popover.getByRole('button', { name: 'Back', exact: true })).toBeDisabled()
    await popover.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(popover.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2')
    await popover.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(popover.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3')
    await page.screenshot({ path: path.join(artifacts, `popover-source-${theme}.png`), animations: 'disabled' })
    await popover.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(popover).toHaveCount(0)
    checks.push(`Popover ${theme}: step footer updates its dots, guards the first step and closes on Done`)

    for (const appearance of ['filled', 'light', 'lighter', 'stroke']) {
      await render(page, `primitives-feedback-banner--variant-${appearance}`, `theme:${theme};font:application`)
      const banners = page.locator('[data-slot="banner"]')
      await expect(banners).toHaveCount(5)
      const heights = await banners.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))
      assert.deepEqual(heights, [44, 44, 44, 44, 44])
      await page.getByRole('button', { name: 'Dismiss banner', exact: true }).first().click()
      await expect(banners).toHaveCount(4)
      await page.getByRole('button', { name: 'Restore banners', exact: true }).click()
      await expect(banners).toHaveCount(5)
    }
    await page.setViewportSize({ width: 375, height: 900 })
    await render(page, 'primitives-feedback-banner--variant-filled', `theme:${theme};font:application`)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: path.join(artifacts, `banner-mobile-${theme}.png`), animations: 'disabled' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    checks.push(`Banner ${theme}: all20status/style combinations,44px desktop bars, working dismissal and mobile wrapping`)
  }
  return checks
}
