import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { expect, test, type Page } from '@playwright/test'
import { sanitizeChannelHtml } from '../lib/sanitize-channel-html'

const inlineImage = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const remoteImage = 'https://sender.example/tracking.gif?message=first&signature=%2Fsafe%2Btoken%3D'
let widgetBundle: string
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))

test.beforeAll(async () => {
  const packagesRoot = path.resolve(moduleDirectory, '../../../../..')
  const result = await build({
    stdin: {
      contents: `
        import * as React from 'react'
        import { createRoot } from 'react-dom/client'
        import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
        import Widget from ${JSON.stringify(path.resolve(moduleDirectory, '../widgets/injection/channel-payload-renderer/widget.client.tsx'))}
        import dictionary from ${JSON.stringify(path.resolve(moduleDirectory, '../i18n/en.json'))}
        const root = createRoot(document.getElementById('root'))
        window.renderEmail = (id, html) => root.render(
          <I18nProvider locale="en" dict={dictionary}>
            <Widget context={{}} data={{ id, _channelPayload: { channelContentType: 'email/rfc822', sanitizedHtml: html } }} />
          </I18nProvider>
        )
      `,
      resolveDir: path.resolve(packagesRoot, '..'),
      loader: 'tsx',
    },
    alias: {
      '@open-mercato/shared': path.join(packagesRoot, 'shared/src'),
      '@open-mercato/ui': path.join(packagesRoot, 'ui/src'),
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  widgetBundle = result.outputFiles[0].text
})

async function renderEmail(page: Page, id: string, rawHtml: string) {
  await page.evaluate(({ messageId, html }) => {
    const fixture = window as typeof window & { renderEmail: (id: string, html: string) => void }
    fixture.renderEmail(messageId, html)
  }, { messageId: id, html: sanitizeChannelHtml(rawHtml) })
}

test('TC-CHANNEL-EMAIL-032: loads remote images only with per-message consent', async ({ page }) => {
  const requestedImages: string[] = []
  const referrers: Array<string | undefined> = []
  await page.route('https://sender.example/**', async (route) => {
    requestedImages.push(route.request().url())
    referrers.push(route.request().headers().referer)
    await route.fulfill({
      contentType: 'image/gif',
      body: Buffer.from(inlineImage.split(',')[1], 'base64'),
    })
  })

  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({ content: widgetBundle })
  const rawHtml = `<p>Customer email</p><img src="${remoteImage}" alt="Remote image" /><img src="${inlineImage}" alt="Inline image" />`
  await renderEmail(page, 'first-message', rawHtml)

  const loadImages = page.getByRole('button', { name: 'Load remote images', exact: true })
  const remote = page.getByRole('img', { name: 'Remote image', exact: true })
  await expect(loadImages).toBeVisible()
  await expect(remote).not.toHaveAttribute('src')
  await expect(page.getByRole('img', { name: 'Inline image' })).toHaveJSProperty('naturalWidth', 1)
  expect(requestedImages).toEqual([])

  await loadImages.click()
  await expect(remote).toHaveAttribute('src', remoteImage)
  await expect.poll(() => requestedImages).toEqual([remoteImage])
  expect(referrers).toEqual([undefined])

  await renderEmail(page, 'second-message', rawHtml)
  await expect(loadImages).toBeVisible()
  await expect(remote).not.toHaveAttribute('src')
  expect(requestedImages).toEqual([remoteImage])

  const updatedRemoteImage = remoteImage.replace('first', 'updated')
  await loadImages.click()
  await expect(remote).toHaveAttribute('src', remoteImage)
  await expect.poll(() => requestedImages.length).toBe(2)
  await expect(remote).toHaveJSProperty('naturalWidth', 1)
  await renderEmail(page, 'second-message', rawHtml.replace(remoteImage, updatedRemoteImage))
  await expect(loadImages).toBeVisible()
  await expect(remote).not.toHaveAttribute('src')
  expect(requestedImages).not.toContain(updatedRemoteImage)

  await loadImages.click()
  await expect.poll(() => requestedImages.includes(updatedRemoteImage)).toBe(true)
  await expect(remote).toHaveAttribute('src', updatedRemoteImage)
})
