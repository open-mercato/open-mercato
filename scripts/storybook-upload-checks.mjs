import assert from 'node:assert/strict'
import path from 'node:path'
import { expect } from '@playwright/test'

export async function checkFileUploads(page, render, artifacts) {
  const checks = []
  const png = async size => {
    const base64 = await page.evaluate(size => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      return canvas.toDataURL('image/png').split(',')[1]
    }, size)
    return { name: `image-${size}.png`, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') }
  }
  for (const theme of ['light', 'dark']) {
    const globals = `theme:${theme};font:application`
    await render(page, 'primitives-inputs-file-upload--variant-default', globals)
    const area = page.locator('[data-slot="file-upload-area"]')
    const bounds = await area.boundingBox()
    assert.equal(bounds.width, 400)
    assert.equal(bounds.height, 202)
    assert.equal(await area.evaluate(node => getComputedStyle(node).borderRadius), '12px')
    const background = await area.evaluate(node => getComputedStyle(node).backgroundColor)
    await area.hover()
    await expect.poll(() => area.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(background)
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Browse File' }).focus()
    await page.keyboard.press('Enter')
    await (await chooser).setFiles({ name: 'keyboard.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf') })
    await expect(page.locator('[data-slot="file-upload-card"]')).toHaveCount(1)
    await page.getByRole('button', { name: 'Cancel upload' }).click()
    await expect(page.locator('[data-slot="file-upload-card"]')).toHaveCount(0)
    const dropped = await page.evaluateHandle(() => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['pdf'], 'dropped.pdf', { type: 'application/pdf' }))
      transfer.items.add(new File(['text'], 'rejected.txt', { type: 'text/plain' }))
      return transfer
    })
    await area.dispatchEvent('dragenter', { dataTransfer: dropped })
    await expect(area).toHaveAttribute('data-drag-active', 'true')
    await area.dispatchEvent('drop', { dataTransfer: dropped })
    await dropped.dispose()
    await expect(area).toHaveAttribute('data-drag-active', 'false')
    await expect(page.getByRole('alert')).toContainText('rejected.txt')
    assert.ok(await page.getByRole('alert').evaluate(node => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--status-error-text)'
      node.appendChild(probe)
      const matches = getComputedStyle(node).color === getComputedStyle(probe).color
      probe.remove()
      return matches
    }))
    await expect(page.locator('[data-slot="file-upload-card"]')).toHaveAttribute('data-status', 'success')
    await page.getByRole('button', { name: 'Remove file' }).click()
    await expect(page.locator('[data-slot="file-upload-card"]')).toHaveCount(0)
    checks.push(`FileUploadArea source size, real hover, keyboard chooser, drag/drop validation, progress and remove work in ${theme}`)

    for (const [status, height] of [['uploading', 94], ['success', 72], ['error', 100]]) {
      await render(page, `primitives-inputs-file-upload-card--variant-${status}`, globals)
      const card = page.locator('[data-slot="file-upload-card"]')
      const bounds = await card.boundingBox()
      assert.equal(bounds.width, 400)
      assert.equal(bounds.height, height)
      assert.equal(await card.evaluate(node => getComputedStyle(node).borderRadius), '12px')
      if (status === 'error') {
        if (artifacts) await page.screenshot({ animations: 'disabled', path: path.join(artifacts, `upload-card-error-${theme}.png`) })
        await page.getByRole('button', { name: 'Try Again' }).focus()
        await page.keyboard.press('Enter')
        await expect(card).toHaveAttribute('data-status', 'uploading')
        await expect(card).toHaveAttribute('data-status', 'success')
      }
      await page.getByRole('button', { name: status === 'uploading' ? 'Cancel upload' : 'Remove file' }).click()
      await expect(card).toHaveCount(0)
      await page.getByRole('button', { name: 'Reset example' }).click()
      await expect(card).toHaveAttribute('data-status', status)
    }
    checks.push(`FileUploadCard matches 400×94/72/100 and supports cancel, retry to completion, remove and reset in ${theme}`)

    await render(page, 'primitives-inputs-file-format-icon--overview', globals)
    const icons = page.locator('[data-slot="file-format-icon"]')
    await expect(icons).toHaveCount(18)
    const formats = await icons.evaluateAll(nodes => nodes.map(node => {
      const bounds = node.getBoundingClientRect()
      const badge = node.querySelector('span[aria-hidden="true"]')
      return { width: bounds.width, height: bounds.height, size: node.dataset.size, tone: node.dataset.tone, images: [...node.querySelectorAll('img')].every(image => image.complete && image.naturalWidth > 0), fill: getComputedStyle(badge).backgroundColor, text: getComputedStyle(badge).color }
    }))
    const luminance = color => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
        const normalized = value / 255
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    for (const format of formats) {
      assert.equal(format.width, format.size === 'sm' ? 32 : 40)
      assert.equal(format.height, format.width)
      assert.ok(format.images)
      const values = [luminance(format.fill), luminance(format.text)].sort((left, right) => right - left)
      assert.ok((values[0] + 0.05) / (values[1] + 0.05) >= 4.5, `${format.tone} label contrast`)
    }
    checks.push(`All 18 FileFormatIcon combinations load original artwork at 40/32px with readable category labels in ${theme}`)

    for (const kind of ['avatar', 'company']) {
      for (const alignment of ['vertical', 'horizontal']) {
        for (const state of ['empty', 'uploaded']) {
          await render(page, `primitives-inputs-image-upload--variant-${kind}-${alignment}-${state}`, globals)
          const upload = page.locator('[data-slot="image-upload"]')
          assert.equal((await upload.boundingBox()).height, alignment === 'vertical' ? 92 : 56)
          const avatar = upload.getByRole('img')
          assert.equal((await avatar.boundingBox()).width, alignment === 'vertical' ? 64 : 56)
          assert.equal((await avatar.boundingBox()).y, (await upload.boundingBox()).y)
          if (state === 'uploaded') {
            await expect(avatar.locator('img')).toHaveJSProperty('naturalWidth', 64)
            await page.getByRole('button', { name: 'Remove', exact: true }).click()
            await expect(upload).toHaveAttribute('data-state', 'empty')
          }
          const input = page.locator('input[type="file"]')
          await input.setInputFiles(await png(64))
          await expect(page.getByRole('alert')).toContainText('400×400')
          await expect(upload).toHaveAttribute('data-state', 'empty')
          const validImage = await png(400)
          await input.setInputFiles(validImage)
          await expect(upload).toHaveAttribute('data-state', 'uploaded')
          await expect(avatar.locator('img')).toHaveJSProperty('naturalWidth', 400)
          await expect(page.getByRole('alert')).toHaveCount(0)
          const previousUrl = await avatar.locator('img').getAttribute('src')
          await input.setInputFiles(validImage)
          await expect(avatar.locator('img')).not.toHaveAttribute('src', previousUrl)
          await page.getByRole('button', { name: 'Remove', exact: true }).click()
        }
      }
    }
    await render(page, 'primitives-inputs-image-upload--variant-disabled', globals)
    await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Change', exact: true })).toBeDisabled()
    await render(page, 'primitives-inputs-image-upload--variant-avatar-vertical-empty', globals)
    await page.locator('input[type="file"]').setInputFiles({ name: 'disguised.png', mimeType: 'image/png', buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') })
    await expect(page.getByRole('alert')).toContainText('could not be read as an image')
    await expect(page.locator('[data-slot="image-upload"]')).toHaveAttribute('data-state', 'empty')
    await render(page, 'primitives-inputs-file-upload--variant-disabled', globals)
    await expect(page.getByRole('button', { name: 'Browse File' })).toBeDisabled()
    checks.push(`All 8 ImageUpload layouts support image dimensions, decode, change, reselect and remove; disabled controls remain inert in ${theme}`)
  }
  const viewport = page.viewportSize()
  await page.setViewportSize({ width: 390, height: 844 })
  for (const id of ['file-upload--variant-default', 'file-upload-card--variant-error', 'image-upload--variant-company-vertical-uploaded']) {
    await render(page, `primitives-inputs-${id}`, 'theme:dark;font:application')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${id} mobile overflow`)
    if (artifacts) await page.screenshot({ animations: 'disabled', path: path.join(artifacts, `upload-mobile-${id}.png`) })
  }
  if (viewport) await page.setViewportSize(viewport)
  checks.push('File, error and image upload layouts stay within a 390px viewport')
  return checks
}
