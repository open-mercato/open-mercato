import { expect, test, type Locator, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'

const projectRoot = process.cwd()
const feedbackTranslations = Object.fromEntries(['en', 'pl', 'es', 'de', 'ko'].map((locale) => [
  locale,
  JSON.parse(readFileSync(path.join(projectRoot, 'packages/onboarding/src/modules/onboarding/i18n', `${locale}.json`), 'utf8')) as Record<string, string>,
])) as Record<string, Record<string, string>>
const shellSource = readFileSync(path.join(projectRoot, 'packages/ui/src/backend/AppShell.tsx'), 'utf8')
const footer = shellSource.match(/<footer className="border-t[\s\S]*?<\/footer>/)?.[0]
if (!footer) throw new Error('[internal] AppShell legal footer fixture not found')

async function mountFeedbackFixture(page: Page, appRoot: string) {
  const componentPath = path.join(projectRoot, appRoot, 'src/components/DemoFeedbackWidget.tsx')
  const globalsPath = path.join(projectRoot, appRoot, 'src/app/globals.css')
  const globals = readFileSync(globalsPath, 'utf8')
    .replace('@import "tailwindcss";', '@import "tailwindcss" source(none);')
    .replace(/@import "[^"\n]*generated[^"\n]*";/g, '')
    .replace(/@source [^;]+;/g, '')
  const stylesheet = await postcss([tailwindcss()]).process(`${globals}\n@source "${componentPath}";\n@source "${path.join(projectRoot, 'packages/ui/src/backend/AppShell.tsx')}";`, { from: globalsPath })
  const bundle = await build({
    stdin: {
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { DemoFeedbackWidget } from ${JSON.stringify(componentPath)};
        const version = 'fixture'; const dictionaries = ${JSON.stringify(feedbackTranslations)}; const t = (key, fallback) => dictionaries[document.documentElement.lang || 'en']?.[key] || fallback || key; const Link = (props) => <a {...props}/>;
        createRoot(document.getElementById('fixture')).render(<><main id="main-content" style={{minHeight:'120vh',display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>Owned page content <p>Final content row</p></main>${footer}<DemoFeedbackWidget demoModeEnabled={true}/></>);`,
      resolveDir: projectRoot,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{
      name: 'fixture-context',
      setup(builder) {
        builder.onResolve({ filter: /^(@open-mercato\/shared\/lib\/i18n\/context|@open-mercato\/ui\/ai\/AiDock|@open-mercato\/ui\/backend\/utils\/apiCall|next\/image)$/ }, (args) => ({ path: args.path, namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => {
          if (args.path === '@open-mercato/shared/lib/i18n/context') return { contents: `export const useT = () => (key, fallback) => { const dictionaries = ${JSON.stringify(feedbackTranslations)}; return dictionaries[document.documentElement.lang || 'en']?.[key] || fallback || key };` }
          if (args.path === '@open-mercato/ui/backend/utils/apiCall') return { contents: `export const apiCall = async () => { const replies = window.__feedbackApiReplies || []; const reply = replies.shift() || {status:200,result:{ok:true}}; return {ok:reply.status >= 200 && reply.status < 300, status:reply.status, result:reply.result, response:new Response(JSON.stringify(reply.result)), cacheStatus:null} };` }
          return { contents: `export const useAiDock = () => ({state:{}}); export default () => null;` }
        })
        builder.onResolve({ filter: /^@open-mercato\/(ui|shared)\// }, (args) => {
          const source = args.path.replace('@open-mercato/', 'packages/').replace(/^(packages\/[^/]+)\//, '$1/src/')
          return builder.resolve(path.join(projectRoot, source), { resolveDir: projectRoot, kind: args.kind })
        })
      },
    }],
  })
  await page.route('http://feedback.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<html><body><div id="fixture"></div></body></html>' }))
  await page.goto('http://feedback.test/')
  await page.addStyleTag({ content: stylesheet.css })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  return page.getByRole('button', { name: 'Open feedback form', exact: true })
}

async function queueFeedbackReplies(page: Page, replies: Array<{ status: number; result: Record<string, unknown> }>) {
  await page.evaluate((nextReplies) => {
    const target = window as Window & { __feedbackApiReplies?: Array<{ status: number; result: Record<string, unknown> }> }
    target.__feedbackApiReplies = nextReplies
  }, replies)
}

function measureFeedbackButton(button: Locator) {
  return button.evaluate((element: HTMLElement) => {
    const caption = element.querySelector('span')
    return {
      width: element.offsetWidth,
      height: element.offsetHeight,
      captionWidth: caption ? caption.offsetWidth : 0,
      captionOpacity: caption ? Number(getComputedStyle(caption).opacity) : 0,
    }
  })
}

async function expectCollapsed(button: Locator) {
  await expect.poll(async () => {
    const { width, height, captionWidth } = await measureFeedbackButton(button)
    return { width, height, captionWidth }
  }).toEqual({ width: 44, height: 44, captionWidth: 0 })
}

async function expectExpanded(button: Locator, viewportWidth: number) {
  await expect.poll(async () => {
    const { width, height, captionWidth, captionOpacity } = await measureFeedbackButton(button)
    return width > 44 && height === 44 && captionWidth > 0 && captionOpacity === 1
  }).toBe(true)
  const bounds = await button.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewportWidth)
}

for (const appRoot of ['apps/mercato', 'packages/create-app/template']) {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    test(`${appRoot}: feedback rests as a 44px circle and expands only on hover or keyboard focus at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)
      const button = await mountFeedbackFixture(page, appRoot)
      await expect(button).toBeVisible()
      await page.mouse.move(0, 0)
      await expectCollapsed(button)

      await button.hover()
      await expectExpanded(button, viewport.width)
      await page.mouse.move(0, 0)
      await expectCollapsed(button)

      for (let attempt = 0; attempt < 10 && !(await button.evaluate((element) => element === document.activeElement)); attempt += 1) {
        await page.keyboard.press('Tab')
      }
      await expect(button).toBeFocused()
      await expectExpanded(button, viewport.width)
      await button.blur()
      await expectCollapsed(button)
    })

    test(`${appRoot}: feedback clears legal links at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport)
      const button = await mountFeedbackFixture(page, appRoot)
      const links = page.getByRole('contentinfo').getByRole('link')
      await expect(button).toBeVisible()
      await expect(page.locator('body')).toHaveAttribute('data-demo-feedback-fab', 'visible')
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await expect.poll(() => page.evaluate(() => Math.abs(window.innerHeight + window.scrollY - document.documentElement.scrollHeight))).toBeLessThan(2)
      for (const caption of ['Feedback', 'Ask a question', 'Contact us']) {
        await expect(button).toContainText(caption)
        for (const hovered of [false, true]) {
          if (hovered) await button.hover()
          else await page.mouse.move(0, 0)
          for (const phase of [0, 300, 600, 900, 1200, 1999]) {
            await button.evaluate((element, currentTime) => {
              for (const animation of element.getAnimations()) {
                animation.pause()
                animation.currentTime = currentTime
              }
            }, phase)
            const buttonBounds = await button.boundingBox()
            expect(buttonBounds).not.toBeNull()
            for (const link of await links.all()) {
              const bounds = await link.boundingBox()
              expect(bounds).not.toBeNull()
              expect(bounds!.y + bounds!.height).toBeLessThan(buttonBounds!.y - 4)
              expect(await link.evaluate((element) => {
                const bounds = element.getBoundingClientRect()
                return [bounds.left + 1, bounds.right - 1].every((horizontal) =>
                  [bounds.top + 1, bounds.bottom - 1].every((vertical) => element.contains(document.elementFromPoint(horizontal, vertical))))
              })).toBe(true)
              await link.click({ trial: true })
            }
          }
        }
      }
      expect((await page.getByText('Final content row', { exact: true }).boundingBox())!.y).toBeLessThan((await button.boundingBox())!.y)
      await page.screenshot({ path: testInfo.outputPath('feedback-footer-clearance.png'), fullPage: true })
      await button.click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()
      await expect(button).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      expect((await links.first().boundingBox())!.y).toBeLessThan((await button.boundingBox())!.y)
      await page.evaluate(() => { document.body.removeAttribute('data-demo-feedback-fab') })
      await expect(page.getByRole('contentinfo')).toHaveCSS('padding-bottom', '12px')
    })
  }
}

test('apps/mercato: displays the disabled-feedback message in every locale and recovers on retry at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mountFeedbackFixture(page, 'apps/mercato')

  for (const locale of ['en', 'pl', 'es', 'de', 'ko']) {
    await page.evaluate((value) => { document.documentElement.lang = value }, locale)
    await queueFeedbackReplies(page, [
      { status: 404, result: { ok: false, error: feedbackTranslations[locale]['demoFeedback.errors.disabled'] } },
      { status: 200, result: { ok: true } },
    ])
    const localizedButton = page.getByRole('button', { name: feedbackTranslations[locale]['demoFeedback.button.ariaLabel'] })
    await expect(localizedButton).toBeVisible()
    await localizedButton.click()
    const dialog = page.getByRole('dialog')
    const bounds = await dialog.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
    await page.locator('#feedback-email').fill(`qa-${locale}@example.test`)
    await page.locator('#feedback-terms').click()
    await page.getByRole('button', { name: feedbackTranslations[locale]['demoFeedback.form.submit'] }).click()
    await expect(page.getByText(feedbackTranslations[locale]['demoFeedback.errors.disabled'])).toBeVisible()
    await page.getByRole('button', { name: feedbackTranslations[locale]['demoFeedback.form.submit'] }).click()
    await expect(page.getByText(feedbackTranslations[locale]['demoFeedback.dialog.successTitle'])).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  }
})

test('apps/mercato: allows retry after a transient feedback delivery error', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const button = await mountFeedbackFixture(page, 'apps/mercato')
  await queueFeedbackReplies(page, [
    { status: 500, result: { ok: false } },
    { status: 200, result: { ok: true } },
  ])
  await button.click()
  await page.locator('#feedback-email').fill('qa-retry@example.test')
  await page.locator('#feedback-terms').click()
  await page.getByRole('button', { name: feedbackTranslations.en['demoFeedback.form.submit'] }).click()
  await expect(page.getByText(feedbackTranslations.en['demoFeedback.errors.generic'])).toBeVisible()
  await page.getByRole('button', { name: feedbackTranslations.en['demoFeedback.form.submit'] }).click()
  await expect(page.getByText(feedbackTranslations.en['demoFeedback.dialog.successTitle'])).toBeVisible()
})
