import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { test } from 'node:test'
import { chromium } from '@playwright/test'
import {
  escapeHtml,
  initializePrototype,
  parseInitArguments,
} from '../../.ai/skills/om-mockup-prototype/scripts/init-mockup.mjs'
import {
  assertBundledVariablesResolve,
  buildTokens,
  parseSyncArguments,
  resolvePrototypeTarget,
} from '../../.ai/skills/om-mockup-prototype/scripts/sync-tokens.mjs'

const repoRoot = resolve(import.meta.dirname, '../..')
const prototypesRoot = join(repoRoot, '.ai/prototypes')

function prototypePath(slug) {
  return join(prototypesRoot, slug)
}

function removePrototype(slug) {
  rmSync(prototypePath(slug), { recursive: true, force: true })
}

test('init arguments reject traversal, missing values, unknown flags, and extra arguments', () => {
  assert.throws(() => parseInitArguments(['../escape', '--requirements', 'requirements.md']), /slug/)
  assert.throws(() => parseInitArguments(['orders', '--requirements']), /Usage/)
  assert.throws(() => parseInitArguments(['--requirements', 'orders.md', 'orders']), /Usage|slug/)
  assert.throws(() => parseInitArguments(['orders', '--requirements', '--unknown']), /must be followed/)
  assert.deepEqual(parseInitArguments(['orders', '--requirements', 'docs/orders.md']), {
    slug: 'orders',
    requirements: 'docs/orders.md',
  })
})

test('HTML substitutions are escaped', () => {
  assert.equal(escapeHtml('<script title="x">&\'</script>'), '&lt;script title=&quot;x&quot;&gt;&amp;&#39;&lt;/script&gt;')
})

test('prototype initialization is atomic and generates reviewer instructions', () => {
  const successfulSlug = `test-prototype-${process.pid}`
  const failedSlug = `failed-prototype-${process.pid}`
  removePrototype(successfulSlug)
  removePrototype(failedSlug)

  try {
    const output = initializePrototype({
      slug: successfulSlug,
      requirements: 'requirements/<script>alert(1)</script>.md',
    })
    assert.equal(output, `.ai/prototypes/${successfulSlug}`)
    const index = readFileSync(join(prototypePath(successfulSlug), 'index.html'), 'utf8')
    assert.match(index, /requirements\/&lt;script&gt;alert\(1\)&lt;\/script&gt;\.md/)
    assert.doesNotMatch(index, /<script>alert\(1\)<\/script>/)
    assert.match(readFileSync(join(prototypePath(successfulSlug), 'README.md'), 'utf8'), /Comments are not live collaboration/)
    assert.match(readFileSync(join(prototypePath(successfulSlug), 'comments.js'), 'utf8'), new RegExp(successfulSlug))

    assert.throws(() => initializePrototype(
      { slug: failedSlug, requirements: 'requirements.md' },
      { buildTokens: () => { throw new Error('token generation failed') } },
    ), /token generation failed/)
    assert.equal(readdirSync(prototypesRoot).some((entry) => entry.startsWith(`.${failedSlug}-staging-`)), false)
    assert.equal(readdirSync(prototypesRoot).includes(failedSlug), false)
  } finally {
    removePrototype(successfulSlug)
    removePrototype(failedSlug)
  }
})

test('token sync rejects ambiguous targets and audits every bundled variable', () => {
  assert.throws(() => parseSyncArguments(['--chek', '.ai/prototypes/orders']), /Usage/)
  assert.throws(() => parseSyncArguments(['.ai/prototypes/orders', 'extra']), /Usage/)
  assert.throws(() => resolvePrototypeTarget(repoRoot), /immediate/)
  assert.doesNotThrow(() => buildTokens())

  const assetsDirectory = mkdtempSync(join(tmpdir(), 'om-prototype-assets-'))
  const outsideDirectory = mkdtempSync(join(tmpdir(), 'om-prototype-outside-'))
  const linkedSlug = `linked-prototype-${process.pid}`
  const linkedTarget = prototypePath(linkedSlug)
  try {
    symlinkSync(outsideDirectory, linkedTarget, 'dir')
    assert.throws(() => resolvePrototypeTarget(linkedTarget), /symbolic link/)
    writeFileSync(join(assetsDirectory, 'components.css'), '.x { color: var(--missing-token); }')
    writeFileSync(join(assetsDirectory, 'screens.css'), '')
    writeFileSync(join(assetsDirectory, 'prototype.css'), '')
    assert.throws(
      () => assertBundledVariablesResolve(':root { --known-token: red; }', assetsDirectory),
      /--missing-token/,
    )
    writeFileSync(join(assetsDirectory, 'components.css'), '.x { color: var(--missing-token, red); }')
    assert.doesNotThrow(() => assertBundledVariablesResolve(':root {}', assetsDirectory))
  } finally {
    rmSync(linkedTarget, { force: true })
    rmSync(assetsDirectory, { recursive: true, force: true })
    rmSync(outsideDirectory, { recursive: true, force: true })
  }
})

test('browser engine isolates storage, keeps reply focus, overlays pins, re-anchors, and tombstones deletes', async (testContext) => {
  const firstSlug = `browser-a-${process.pid}`
  const secondSlug = `browser-b-${process.pid}`
  removePrototype(firstSlug)
  removePrototype(secondSlug)
  initializePrototype({ slug: firstSlug, requirements: 'requirements-a.md' })
  initializePrototype({ slug: secondSlug, requirements: 'requirements-b.md' })

  const firstIndexPath = join(prototypePath(firstSlug), 'index.html')
  writeFileSync(
    firstIndexPath,
    readFileSync(firstIndexPath, 'utf8').replace(
      '<!-- Screen content.',
      '<div id="keyboard-hotspot" data-goto="s1">Keyboard hotspot</div>\n          <!-- Screen content.',
    ),
  )

  const prototypeDirectories = new Map([
    [firstSlug, prototypePath(firstSlug)],
    [secondSlug, prototypePath(secondSlug)],
  ])
  const contentTypes = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.md', 'text/markdown; charset=utf-8'],
  ])
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
    const segments = requestUrl.pathname.split('/').filter(Boolean)
    const directory = prototypeDirectories.get(segments[0])
    const filename = segments[1] || 'index.html'
    if (!directory || basename(filename) !== filename) {
      response.writeHead(404).end('Not found')
      return
    }
    try {
      const extension = filename.slice(filename.lastIndexOf('.'))
      response.writeHead(200, { 'Content-Type': contentTypes.get(extension) || 'application/octet-stream' })
      response.end(readFileSync(join(directory, filename)))
    } catch (error) {
      response.writeHead(404).end('Not found')
    }
  })

  await new Promise((resolveListening) => server.listen(0, '127.0.0.1', resolveListening))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const origin = `http://127.0.0.1:${address.port}`
  let browser
  let context

  try {
    try {
      browser = await chromium.launch({ headless: true })
    } catch (error) {
      testContext.skip(`Chromium is unavailable in this runner: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
      return
    }
    context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${origin}/${firstSlug}/index.html`)
    const keyboardHotspot = page.locator('#keyboard-hotspot')
    await assert.doesNotReject(async () => {
      assert.equal(await keyboardHotspot.getAttribute('role'), 'button')
      assert.equal(await keyboardHotspot.getAttribute('tabindex'), '0')
      await keyboardHotspot.focus()
      await keyboardHotspot.press('Enter')
      await page.locator('#s1.proto-arrived').waitFor()
    })

    await page.getByRole('button', { name: 'Comment', exact: true }).click()
    await page.locator('.page-actions button').click()
    await page.getByPlaceholder('What should change?').fill('Review this action')
    await page.getByRole('button', { name: 'Add comment' }).click()
    assert.equal(await page.locator('.anno-pin-layer .anno-pin').count(), 1)
    assert.equal(await page.locator('.page-actions button .anno-pin').count(), 0)

    await page.goto(`${origin}/${secondSlug}/index.html`)
    await page.getByRole('button', { name: 'Threads' }).click()
    await page.getByText('No comments yet. Switch to Comment mode and select an element.').waitFor()
    assert.equal(await page.locator('.anno-thread').count(), 0)

    await page.goto(`${origin}/${firstSlug}/index.html`)
    await page.locator('.anno-pin').click()
    const reply = page.getByPlaceholder('Reply…')
    await reply.click()
    await reply.fill('Focus remains here')
    assert.equal(await reply.evaluate((element) => document.activeElement === element), true)
    assert.equal(await reply.inputValue(), 'Focus remains here')

    await page.locator('.page-actions button').evaluate((element) => element.remove())
    await page.evaluate(() => window.dispatchEvent(new Event('resize')))
    await page.getByRole('button', { name: 'Threads' }).click()
    await page.getByRole('button', { name: 'Threads' }).click()
    await page.getByText('Orphaned threads (1)').waitFor()
    await page.locator('.anno-orphans .anno-thread').click()
    await page.getByRole('button', { name: 'Re-anchor' }).click()
    await page.locator('.icon-btn').click()
    assert.equal(await page.getByText('Orphaned threads (1)').count(), 0)
    assert.equal(await page.locator('.anno-pin-layer .anno-pin').count(), 1)

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Delete' }).click()
    assert.equal(await page.locator('.anno-pin').count(), 0)
    const localState = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `om-prototype-comments:v2:${firstSlug}`)
    assert.equal(localState.operations.at(-1).type, 'delete')
    await page.reload()
    assert.equal(await page.locator('.anno-pin').count(), 0)
  } finally {
    if (context) await context.close()
    if (browser) await browser.close()
    await new Promise((resolveClosed) => server.close(resolveClosed))
    removePrototype(firstSlug)
    removePrototype(secondSlug)
  }
})
