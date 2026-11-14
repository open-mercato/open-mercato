import { test, expect } from '@playwright/test'
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const canary = 'https://ai-image-canary.invalid/pixel?data=inert'
const typedParts = [
  ['product', 'imageUrl'],
  ['person', 'avatarUrl'],
  ['company', 'logoUrl'],
].map(([kind, field]) => ({
  componentId: `open-mercato.${kind}-card`,
  payload: { name: `Visible typed ${kind}`, [field]: canary, kind: 'deal' },
}))
const content = [
  '**Visible answer**',
  `![Inline image](${canary})`,
  `![Reference image][canary]\n\n[canary]: ${canary}`,
  '![Relative image](/canary?data=inert)',
  '![Protocol image](//ai-image-canary.invalid/pixel?data=inert)',
  `<img src="${canary}" alt="Raw HTML image">`,
  '| Detail | Value |\n| --- | --- |\n| Status | Available |',
  '[Ordinary link](https://example.invalid/details)',
  ...[
    ['product', 'imageUrl'],
    ['product', 'image'],
    ['person', 'avatarUrl'],
    ['person', 'avatar'],
    ['company', 'logoUrl'],
    ['company', 'logo'],
  ].map(([kind, field], index) => {
    const payload = JSON.stringify({ name: `Visible ${kind} ${index}`, [field]: canary })
    return index % 2 === 0
      ? `\`\`\`open-mercato:${kind}\n${payload}\n\`\`\``
      : `open-mercato:${kind} ${payload}`
  }),
].join('\n\n')

let bundle: string

test.beforeAll(async () => {
  const require = createRequire(import.meta.url)
  const sourceRoot = (packageName: string) => path.resolve(path.dirname(require.resolve(packageName)), '../src')
  const result = await build({
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    alias: {
      '@open-mercato/ui': sourceRoot('@open-mercato/ui'),
      '@open-mercato/shared': sourceRoot('@open-mercato/shared'),
      '@open-mercato/ai-assistant': sourceRoot('@open-mercato/ai-assistant'),
    },
    stdin: {
      resolveDir: path.dirname(fileURLToPath(import.meta.url)),
      loader: 'tsx',
      contents: `
        import * as React from 'react'
        import { createRoot } from 'react-dom/client'
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
        import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
        import { AiChat } from '@open-mercato/ui/ai/AiChat'
        import { AiMessageContent } from '@open-mercato/ui/ai/AiMessageContent'
        import '@open-mercato/ui/ai/records/registry'
        const content = ${JSON.stringify(content)}
        const uiParts = ${JSON.stringify(typedParts)}
        createRoot(document.getElementById('root')).render(
          <QueryClientProvider client={new QueryClient()}>
            <I18nProvider locale="en" dict={{}}>
              {location.search === '?chat'
                ? <AiChat agentId="image-policy.test" conversationId="image-policy" initialMessages={[{ role: 'assistant', content }]} uiParts={uiParts} />
                : <AiMessageContent content={content} />}
            </I18nProvider>
          </QueryClientProvider>
        )
      `,
    },
  })
  bundle = result.outputFiles[0].text
})

for (const surface of ['chat', 'standalone']) {
  test(`TC-AI-IMAGE-001: ${surface} makes no requests for model-supplied images`, async ({ page }, testInfo) => {
    const imageRequests: string[] = []
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.hostname === 'ai-image-canary.invalid' || url.pathname === '/canary') {
        imageRequests.push(url.href)
        await route.abort()
      } else if (url.pathname.startsWith('/api/')) {
        await route.fulfill({ json: {
          providers: [],
          allowRuntimeModelOverride: false,
          conversation: { conversationId: 'image-policy', isOwner: true },
          messages: [{ id: 'answer', role: 'assistant', content, uiParts: typedParts, attachmentIds: [], files: [] }],
        } })
      } else {
        await route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' })
      }
    })
    await page.goto(`http://ai-image-policy.test/?${surface}`)
    await page.evaluate((url) => {
      const image = document.createElement('img')
      image.src = url
      document.body.append(image)
    }, canary)
    await expect.poll(() => imageRequests.length).toBe(1)
    await page.locator('body > img').evaluate((image) => image.remove())
    imageRequests.length = 0

    await page.addScriptTag({ content: bundle })
    const answer = page.locator('[data-ai-message-content]')
    await expect.poll(async () => ({ text: await page.locator('#root').innerText(), errors }))
      .toMatchObject({ text: expect.stringContaining('Visible answer'), errors: [] })
    await expect(answer.getByText('Visible answer', { exact: true })).toBeVisible()
    await expect(answer.getByText('Visible product 0', { exact: true })).toBeVisible()
    await expect(answer.getByText('Visible person 3', { exact: true })).toBeVisible()
    await expect(answer.getByText('Visible company 5', { exact: true })).toBeVisible()
    await expect(answer.getByRole('table')).toBeVisible()
    await expect(answer.getByRole('link', { name: 'Ordinary link' })).toHaveAttribute('href', 'https://example.invalid/details')
    if (surface === 'chat') {
      for (const kind of ['product', 'person', 'company']) {
        await expect(page.locator('#root').getByText(`Visible typed ${kind}`, { exact: true })).toHaveCount(2)
      }
    }
    await page.waitForLoadState('networkidle')
    expect(errors).toEqual([])
    expect(imageRequests).toEqual([])
    await expect(page.locator('#root img')).toHaveCount(0)
    await expect(answer).toContainText('Inline image')
    await expect(answer).toContainText('Reference image')
    const screenshotPath = testInfo.outputPath(`${surface}-image-policy.png`)
    await page.screenshot({ path: screenshotPath })
    await testInfo.attach(`${surface}-image-policy`, { path: screenshotPath, contentType: 'image/png' })
  })
}
