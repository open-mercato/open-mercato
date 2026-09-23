import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

export async function checkNavigationMenus(page, render, artifacts) {
  const report={date:'2026-09-12',checks:[],errors:[]}
  const onPageError = error => report.errors.push(error.message)
  page.on('pageerror', onPageError)
  const open = (name, theme) => render(page, `primitives-navigation-${name}--overview`, `theme:${theme};font:application`)
  try {
   for(const theme of ['light','dark']) {
    await open('tabs',theme)
    await page.waitForSelector('[data-slot="tabs"][data-variant="card"]')
    for(const variant of ['card','list']) {
     const groups=page.locator('[data-slot="tabs"][data-variant="'+variant+'"]')
     assert.equal(await groups.count(),7)
     for(const [index,group] of (await groups.all()).entries()) {
      const tabs=group.getByRole('tab')
      assert.equal(await tabs.count(),index+2)
      await tabs.first().focus();await page.keyboard.press('End')
      assert.equal(await tabs.last().getAttribute('aria-selected'),'true')
      assert.equal(await group.getByRole('tabpanel').getAttribute('id'),await tabs.last().getAttribute('aria-controls'))
      await page.keyboard.press('Home')
      assert.equal(await tabs.first().getAttribute('aria-selected'),'true')
      await page.keyboard.press('ArrowDown')
      assert.equal(await tabs.nth(1).getAttribute('aria-selected'),'true')
     }
     report.checks.push(theme+': '+variant+' seven quantities 2..8, End/Home/ArrowDown and panel relationship')
    }
    const disabledGroup=page.locator('[data-slot="tabs"]').filter({has:page.locator('[role="tab"][disabled]')}).last()
    await disabledGroup.getByRole('tab').first().focus();await page.keyboard.press('ArrowRight')
    assert.equal(await disabledGroup.getByRole('tab').last().getAttribute('aria-selected'),'true')
    assert.ok(await disabledGroup.getByRole('tab').nth(1).isDisabled())
    report.checks.push(theme+': horizontal arrows skip disabled tab')
    await open('breadcrumb',theme)
    await page.waitForSelector('[data-slot="breadcrumb"][data-divider="dot"]')
    const crumbs=page.locator('[data-slot="breadcrumb"]').filter({has:page.locator('a[href^="#"]')})
    const sourceCrumbs=(await crumbs.all()).slice(-9)
    assert.equal(sourceCrumbs.length,9)
    for(const [index,crumb] of sourceCrumbs.entries()) {
     assert.equal(await crumb.locator('[data-slot="breadcrumb-item"]').count(),index%3+3)
     assert.equal(await crumb.locator('[aria-current="page"]').count(),1)
     assert.ok(await crumb.locator('[data-slot="breadcrumb-separator"]').evaluateAll(nodes=>nodes.every(node=>node.getAttribute('aria-hidden')==='true')))
    }
    await sourceCrumbs[0].getByRole('link').first().focus();await page.keyboard.press('Enter')
    assert.ok(page.url().includes('#'))
    report.checks.push(theme+': all 9 breadcrumb combinations, decorative separators, current page and valid local anchor')
    await open('accordion',theme)
    await page.waitForSelector('[data-slot="accordion-trigger"] > [data-slot="accordion-trigger-indicator"]:first-child')
    const start=page.locator('[data-slot="accordion-trigger"] > [data-slot="accordion-trigger-indicator"]:first-child').locator('..')
    await start.first().focus();await page.keyboard.press('Enter')
    assert.equal(await start.first().getAttribute('aria-expanded'),'true')
    await page.keyboard.press('Enter')
    assert.equal(await start.first().getAttribute('aria-expanded'),'false')
    assert.ok(await start.last().isDisabled())
    report.checks.push(theme+': start indicator opens/closes by Enter and disabled item is inert')
    await open('segmented-control',theme)
    await page.waitForSelector('[data-slot="segmented-control"][aria-labelledby]')
    const groups=page.locator('[data-slot="segmented-control"][aria-labelledby]')
    assert.equal(await groups.count(),6)
    for(const group of await groups.all()) {
     const radios=group.getByRole('radio')
     assert.equal(await radios.count(),3)
     const disabled=await radios.first().isDisabled()
     if(!disabled) {
      await radios.first().focus();await page.keyboard.press('ArrowRight', { delay: 50 })
      await page.waitForFunction(node=>node.getAttribute('aria-checked')==='true',await radios.nth(1).elementHandle())
      assert.equal(await radios.nth(1).getAttribute('aria-checked'),'true')
     }
     for(const radio of await radios.all()) assert.ok(await radio.getAttribute('aria-label') || (await radio.innerText()).trim())
     const box=await group.boundingBox();assert.equal(box.height,36)
     assert.equal((await radios.first().boundingBox()).height,28)
    }
    report.checks.push(theme+': three segment content types, native keyboard/disabled, labels and 36/28px source geometry')
   }
   assert.deepEqual(report.errors,[])
   return report.checks
  } finally {
   if (artifacts) fs.writeFileSync(path.join(artifacts, 'navigation-menus-browser-validation.json'), JSON.stringify(report, null, 2))
   page.off('pageerror', onPageError)
  }
}
