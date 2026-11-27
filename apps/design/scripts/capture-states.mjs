import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  CAPTURE_USAGE,
  buildCapturePlan,
  captureHasFailure,
  formatSummaryTable,
  parseCaptureArgs,
  summarizeCaptures,
} from '../src/lib/capture-plan.ts'
import { appRoot, repoRoot } from './workspace-resolve.mjs'

const MANIFEST_FILE = path.join(appRoot, 'src', 'generated', 'registry-manifest.json')
const PLAYWRIGHT_FALLBACKS = [
  path.join(repoRoot, 'node_modules', 'playwright', 'index.mjs'),
  '/Users/merynos/Documents/GitHub/open-mercato/node_modules/playwright/index.mjs',
]
const VIEWPORT_HEIGHT = 900
const NAVIGATION_TIMEOUT_MS = 90000
const RENDER_TIMEOUT_MS = 30000
const SETTLE_MS = 400
const SMALL_TARGET_PX = 24
const SAMPLE_LIMIT = 5
const RENDERED_SELECTOR = '[data-preview-layout]'

async function loadPlaywright() {
  try {
    return await import('playwright')
  } catch (primaryError) {
    for (const candidate of PLAYWRIGHT_FALLBACKS) {
      try {
        return await import(candidate)
      } catch {
        continue
      }
    }
    throw new Error(`Playwright is not installed: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`)
  }
}

function auditDocument({ smallTargetPx, sampleLimit }) {
  const viewportWidth = document.documentElement.clientWidth
  const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)

  const isVisible = (element) => {
    const style = window.getComputedStyle(element)
    if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  const labelOf = (element) => {
    const labelledBy = element.getAttribute('aria-labelledby')
    const referenced = labelledBy
      ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
      : ''
    const fieldLabels = 'labels' in element && element.labels
      ? Array.from(element.labels).map((label) => label.textContent ?? '').join(' ')
      : ''
    const candidates = [
      element.getAttribute('aria-label'),
      referenced,
      fieldLabels,
      element.getAttribute('title'),
      element.getAttribute('placeholder'),
      element.textContent,
    ]
    const label = candidates.find((candidate) => candidate && candidate.trim().length > 0) ?? ''
    return label.replace(/\s+/g, ' ').trim().slice(0, 80)
  }

  const describe = (element) => {
    const rect = element.getBoundingClientRect()
    return {
      tag: element.tagName.toLowerCase(),
      label: labelOf(element),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  }

  const hasClippingAncestor = (element) => {
    let ancestor = element.parentElement
    while (ancestor && ancestor !== document.body) {
      const overflowX = window.getComputedStyle(ancestor).overflowX
      if (overflowX !== 'visible') return true
      ancestor = ancestor.parentElement
    }
    return false
  }

  const leavesViewport = (element) => {
    const rect = element.getBoundingClientRect()
    return rect.right > viewportWidth + 1 || rect.left < -1
  }

  const overflowing = []
  for (const element of document.body.querySelectorAll('*')) {
    if (!isVisible(element) || !leavesViewport(element)) continue
    if (window.getComputedStyle(element).position === 'fixed' && element.getBoundingClientRect().left >= viewportWidth) continue
    if (hasClippingAncestor(element)) continue
    if (overflowing.some((reported) => reported.contains(element))) continue
    overflowing.push(element)
  }

  const interactiveSelector = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'summary',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="slider"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ')
  const smallTargets = []
  for (const element of document.body.querySelectorAll(interactiveSelector)) {
    if (element.closest('[aria-hidden="true"], [inert]')) continue
    if (!isVisible(element)) continue
    const rect = element.getBoundingClientRect()
    if (rect.width >= smallTargetPx && rect.height >= smallTargetPx) continue
    smallTargets.push(element)
  }

  return {
    documentWidth,
    pageOverflow: documentWidth > viewportWidth,
    overflowingElementCount: overflowing.length,
    overflowingElements: overflowing.slice(0, sampleLimit).map(describe),
    smallTargetCount: smallTargets.length,
    smallTargets: smallTargets.slice(0, sampleLimit).map(describe),
  }
}

async function captureTarget(context, target, outDir) {
  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  try {
    await page.goto(target.url, { waitUntil: 'networkidle', timeout: NAVIGATION_TIMEOUT_MS })
    await page.waitForSelector(RENDERED_SELECTOR, { timeout: RENDER_TIMEOUT_MS })
    await page.waitForLoadState('networkidle', { timeout: NAVIGATION_TIMEOUT_MS })
    await page.waitForTimeout(SETTLE_MS)
    const file = path.join(outDir, target.file)
    await mkdir(path.dirname(file), { recursive: true })
    await page.screenshot({ path: file, fullPage: true })
    const audit = await page.evaluate(auditDocument, { smallTargetPx: SMALL_TARGET_PX, sampleLimit: SAMPLE_LIMIT })
    return { ...target, consoleErrors, pageErrors, ...audit }
  } catch (error) {
    pageErrors.push(`capture failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
    return {
      ...target,
      consoleErrors,
      pageErrors,
      documentWidth: 0,
      pageOverflow: false,
      overflowingElementCount: 0,
      overflowingElements: [],
      smallTargetCount: 0,
      smallTargets: [],
    }
  } finally {
    await page.close()
  }
}

async function runPool(tasks, concurrency) {
  const results = new Array(tasks.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor
      cursor += 1
      results[index] = await tasks[index]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
  return results
}

async function main() {
  let options
  try {
    options = parseCaptureArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${CAPTURE_USAGE}\n`)
    return 2
  }
  if (options.help) {
    process.stdout.write(`${CAPTURE_USAGE}\n`)
    return 0
  }

  const manifest = JSON.parse(await readFile(MANIFEST_FILE, 'utf8'))
  let plan
  try {
    plan = buildCapturePlan(manifest, options)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }

  const outDir = path.resolve(options.out)
  await mkdir(outDir, { recursive: true })
  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch()
  const contexts = new Map()
  const contextFor = async (target) => {
    const key = `${target.width}:${target.mode}`
    if (!contexts.has(key)) {
      contexts.set(
        key,
        browser.newContext({
          viewport: { width: target.width, height: VIEWPORT_HEIGHT },
          deviceScaleFactor: 1,
          colorScheme: target.mode,
        }),
      )
    }
    return contexts.get(key)
  }

  process.stdout.write(`[capture] ${plan.length} captures from ${options.base} into ${outDir}\n`)
  let finished = 0
  let results
  try {
    results = await runPool(
      plan.map((target) => async () => {
        const result = await captureTarget(await contextFor(target), target, outDir)
        finished += 1
        if (finished % 20 === 0 || finished === plan.length) process.stdout.write(`[capture] ${finished}/${plan.length}\n`)
        return result
      }),
      options.concurrency,
    )
  } finally {
    await browser.close()
  }

  const summary = summarizeCaptures(results)
  const failed = results.filter(captureHasFailure)
  const report = {
    generatedAt: new Date().toISOString(),
    base: options.base,
    group: options.group,
    entries: options.entries,
    widths: options.widths,
    modes: options.modes,
    smallTargetPx: SMALL_TARGET_PX,
    summary,
    failedCaptures: failed.map((result) => result.file),
    captures: results,
  }
  await writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)

  process.stdout.write(`\n${formatSummaryTable(summary)}\n\n`)
  for (const result of failed) {
    const reasons = [
      ...result.pageErrors.map((message) => `page error: ${message}`),
      ...result.consoleErrors.map((message) => `console error: ${message}`),
      ...(result.pageOverflow ? [`document is ${result.documentWidth} px wide in a ${result.width} px viewport`] : []),
    ]
    process.stdout.write(`${result.file}\n${reasons.map((reason) => `  ${reason.split('\n')[0]}`).join('\n')}\n`)
  }
  process.stdout.write(`[capture] report: ${path.join(outDir, 'report.json')}\n`)
  return failed.length > 0 && options.fail ? 1 : 0
}

process.exitCode = await main()
