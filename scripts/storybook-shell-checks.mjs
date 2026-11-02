import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'

export async function checkShellCompositions(page, render, artifacts) {
  const checks = []
  const geometry = []
  for (const theme of ['light', 'dark']) {
    const globals = `theme:${theme};font:application`
    for (const appearance of ['page', 'section']) {
      for (const type of ['basic', 'avatar', 'icon', 'brand', 'company']) {
        await render(page, `backend-scaffolding-page--variant-source-${appearance}-${type}`, globals)
        const header = page.locator('[data-slot="page-header"]')
        await expect(header).toBeVisible()
        const height = (await header.boundingBox()).height
        assert.equal(height, appearance === 'page' ? 88 : 80, `${appearance}/${type}`)
        await expect(header.getByRole('heading', { level: appearance === 'page' ? 1 : 2 })).toHaveText('Team overview')
        await expect(header.locator('[data-slot="page-header-leading"]')).toHaveCount(type === 'basic' ? 0 : 1)
        if (type !== 'basic') assert.equal((await header.locator('[data-slot="page-header-leading"]').boundingBox()).width, 48)
        assert.ok(await header.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)))
        geometry.push({ theme, appearance, type, height })
        if (artifacts && appearance === 'page' && type === 'avatar') await header.screenshot({ path: path.join(artifacts, `shell-page-header-${theme}.png`) })
      }
    }
    await render(page, 'backend-scaffolding-page--variant-source-page-options', globals)
    const header = page.locator('[data-slot="page-header"]')
    await page.getByRole('checkbox', { name: 'Search', exact: true }).uncheck()
    await expect(header.getByRole('button', { name: 'Search', exact: true })).toHaveCount(0)
    await page.getByRole('checkbox', { name: 'Action buttons', exact: true }).uncheck()
    await expect(header.getByRole('button', { name: 'Create request', exact: true })).toHaveCount(0)
    await page.getByRole('checkbox', { name: 'Action buttons', exact: true }).check()
    await header.getByRole('button', { name: 'Create request', exact: true }).click()
    await page.getByRole('textbox', { name: 'Draft title', exact: true }).fill('Example request')
    await page.getByRole('textbox', { name: 'Draft title', exact: true }).press('Control+Enter')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('output')).toHaveText('Local draft: Example request')
    await page.getByRole('checkbox', { name: 'Dropdown', exact: true }).check()
    await header.getByRole('button', { name: 'Last month', exact: true }).click()
    await page.getByRole('button', { name: 'Last year', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(header.getByRole('button', { name: 'Last year', exact: true })).toBeVisible()
    await render(page, 'backend-scaffolding-page--variant-source-section-basic', globals)
    const download = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Export', exact: true }).click()
    assert.equal((await download).suggestedFilename(), 'page-header-example.json')
    checks.push(`All ten source header types, optional content, local draft keyboard submit and real export work in ${theme}`)

    await render(page, 'primitives-navigation-sidebar--variant-items', globals)
    const items = page.locator('[data-slot="sidebar-item"]')
    await expect(items).toHaveCount(6)
    for (const collapsed of ['false', 'true']) {
      const group = page.locator(`[data-slot="sidebar-item"][data-collapsed="${collapsed}"]`)
      assert.equal((await group.first().boundingBox()).width, collapsed === 'true' ? 36 : 232)
      assert.equal((await group.first().boundingBox()).height, 36)
      const background = await group.nth(1).evaluate(node => getComputedStyle(node).backgroundColor)
      await group.nth(1).hover()
      await expect.poll(() => group.nth(1).evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(background)
      await group.nth(1).focus()
      await page.keyboard.press('Enter')
      await expect(group.nth(1)).toHaveAttribute('aria-current', 'page')
      await expect(group.first()).not.toHaveAttribute('aria-current')
      await expect(group.nth(1)).toHaveAccessibleName('Calendar')
    }
    await render(page, 'primitives-navigation-sidebar--variant-identity-cards', globals)
    const identities = page.locator('[data-slot="sidebar-identity"]')
    await expect(identities).toHaveCount(4)
    assert.deepEqual(await identities.evaluateAll(nodes => nodes.map(node => [node.getBoundingClientRect().width, node.getBoundingClientRect().height])), [[248,64],[248,64],[64,64],[64,64]])
    await identities.first().click()
    await page.getByRole('button', { name: 'Apex', exact: true }).click()
    await expect(identities.first()).toHaveAccessibleName('Apex Finance & Banking')
    checks.push(`Sidebar item states, 36px geometry, named collapsed controls and 64px identity cards work in ${theme}`)

    for (const [type, height] of [['meeting',152], ['progress',130], ['link',156], ['gift',64], ['storage',126], ['support',108]]) {
      await render(page, `primitives-navigation-sidebar--variant-feature-${type}`, globals)
      const cards = page.locator('[data-slot="sidebar-feature-card"]')
      await expect(cards).toHaveCount(4)
      const sizes = await cards.evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })))
      assert.ok(sizes.every(size => size.width === 232 && size.height === height), `${type}: ${JSON.stringify(sizes)}`)
      geometry.push({ theme, feature: type, sizes })
      if (artifacts && type === 'meeting') await page.locator('.om-entry-stage').screenshot({ path: path.join(artifacts, `shell-feature-cards-${theme}.png`) })
      if (type === 'storage') {
        const syncing = page.getByRole('button', { name: /File syncing/ }).first()
        await expect(syncing).toHaveAttribute('aria-pressed', 'false')
        await syncing.click()
        await expect(syncing).toHaveAttribute('aria-pressed', 'true')
        await expect(syncing).toContainText('(Running)')
      }
      if (type === 'meeting' || type === 'support') {
        await page.getByRole('button', { name: 'Dismiss card', exact: true }).first().click()
        await expect(cards).toHaveCount(3)
        await page.getByRole('button', { name: 'Restore card', exact: true }).click()
        await expect(cards).toHaveCount(4)
      }
      if (type === 'link') {
        await page.getByRole('link', { name: 'View plans', exact: true }).first().click()
        await expect(page.locator('[data-slot="sidebar-feature-details"]')).toBeVisible()
      }
    }
    checks.push(`All 24 source feature-card combinations and their real dismissal, detail and pause interactions work in ${theme}`)

    for (const product of ['hr', 'finance']) {
      for (const variant of ['expanded', 'collapsed', 'feature']) {
        await render(page, `primitives-navigation-sidebar--variant-${product}-${variant}`, globals)
        const sidebar = page.locator('[data-slot="sidebar"]')
        await expect(sidebar).toBeVisible()
        assert.equal((await sidebar.boundingBox()).height, 900)
        assert.equal((await sidebar.boundingBox()).width, variant === 'collapsed' ? 80 : 272)
        if (artifacts && product === 'hr' && variant === 'feature') await sidebar.screenshot({ path: path.join(artifacts, `shell-sidebar-${theme}.png`) })
        await expect(sidebar.locator('[data-slot="sidebar-feature-card"]')).toHaveCount(variant === 'feature' ? 1 : 0)
        await sidebar.getByRole('button', { name: 'Settings', exact: true }).click()
        await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
        const toggle = page.getByRole('button', { name: variant === 'collapsed' ? 'Expand sidebar' : 'Collapse sidebar', exact: true })
        await toggle.click()
        assert.equal((await sidebar.boundingBox()).width, variant === 'collapsed' ? 272 : 80)
      }
      for (const type of ['default', 'icons']) {
        await render(page, `primitives-navigation-sidebar--variant-topbar-${product}-${type}`, globals)
        const topbar = page.locator('[data-slot="topbar"]')
        await expect(topbar).toBeVisible()
        assert.equal((await topbar.boundingBox()).width, 1440)
        assert.equal((await topbar.boundingBox()).height, 80)
        await topbar.getByRole('button', { name: product === 'hr' ? 'Calendar' : 'My Cards', exact: true }).click()
        await expect(topbar.getByRole('button', { name: product === 'hr' ? 'Calendar' : 'My Cards', exact: true })).toHaveAttribute('aria-current', 'page')
        await topbar.getByRole('searchbox', { name: 'Filter navigation', exact: true }).fill('dashboard')
        await expect(topbar.locator('[data-slot="sidebar-item"]')).toHaveCount(1)
        await topbar.getByRole('button', { name: 'Notifications', exact: true }).click()
        await expect(page.getByText('No new notifications in this example.', { exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
      }
    }
    checks.push(`All six 272/80px sidebars and four 1440×80px topbars support local navigation, collapse, search and popovers in ${theme}`)
    await render(page, 'primitives-navigation-sidebar--variant-brand-artwork', globals)
    const logos = page.locator('figure img')
    await expect(logos).toHaveCount(6)
    assert.ok(await logos.evaluateAll(nodes => nodes.every(image => image.complete && image.naturalWidth > 0)))
    checks.push(`All six original Synergy and Apex artwork variants load locally in ${theme}`)
  }
  if (artifacts) fs.writeFileSync(path.join(artifacts, 'shell-browser-validation.json'), JSON.stringify({ checks, geometry }, null, 2))
  return checks
}
