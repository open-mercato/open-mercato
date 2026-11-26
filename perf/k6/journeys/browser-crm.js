import { browser } from 'k6/browser'
import { check } from 'k6'
import exec from 'k6/execution'
import { env } from '../lib/config.js'
import { userForVu } from '../lib/auth.js'
import { samplePerson, sampleSearchTerm } from '../lib/catalog.js'
import { journeyDuration, journeyRuns } from '../lib/metrics.js'
import { applyTimelineTags } from '../lib/steps.js'

const STEP_TIMEOUT_MS = 30000
const JOURNEY = 'browser.crm'

function url(path) {
  return `${env.baseUrl}${path}`
}

function markStep(name, ok) {
  check(null, { [`browser ${name}`]: () => ok }, { group: 'browser', journey: JOURNEY, name: `browser:${name}`, strict: '1' })
}

async function runStep(name, action) {
  try {
    await action()
    markStep(name, true)
    return true
  } catch (error) {
    markStep(name, false)
    console.warn(`[browser] step ${name} failed: ${error && error.message ? error.message : error}`)
    return false
  }
}

async function waitForUrlMatch(page, pattern, timeoutMs = STEP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pattern.test(page.url())) return
    await page.waitForTimeout(250)
  }
  throw new Error(`[internal] url did not match ${pattern} within ${timeoutMs} ms (at ${page.url()})`)
}

async function navigate(page, path) {
  await page.goto(url(path), { waitUntil: 'load', timeout: STEP_TIMEOUT_MS })
}

async function login(page) {
  const user = userForVu({ fromEnd: true })
  await navigate(page, '/login')
  await page.locator('#email').fill(user.email)
  await page.locator('#password').fill(user.password)
  await page.locator('button[type="submit"]').click()
  await waitForUrlMatch(page, /\/backend(\/|$|\?)/)
}

async function peopleList(page) {
  await navigate(page, '/backend/customers/people')
  await page.waitForSelector('tbody tr', { timeout: STEP_TIMEOUT_MS })
}

async function personDetail(page) {
  const target = samplePerson()
  if (!target) throw new Error('[internal] catalog has no people')
  await navigate(page, `/backend/customers/people-v2/${target.id}`)
  await page.waitForSelector('[role="tab"]', { timeout: STEP_TIMEOUT_MS })
  const tabs = await page.$$('[role="tab"]')
  for (const index of [1, 2]) {
    if (tabs[index]) {
      await tabs[index].click()
      await page.waitForTimeout(1000)
    }
  }
}

async function typeInSearch(page) {
  await navigate(page, '/backend/customers/people')
  const entry = sampleSearchTerm('common') || sampleSearchTerm('prefix') || { term: 'perf' }
  const input = page.locator('main input[type="search"]')
  await input.click()
  await input.type(entry.term, { delay: 120 })
  await page.waitForTimeout(2000)
  await page.waitForSelector('tbody', { timeout: STEP_TIMEOUT_MS })
}

async function pipelineCard(page) {
  await navigate(page, '/backend/customers/deals/pipeline')
  await page.waitForSelector('[aria-roledescription]', { timeout: STEP_TIMEOUT_MS })
  await page.locator('[aria-roledescription]').first().click()
  await waitForUrlMatch(page, /\/backend\/customers\/deals\/[0-9a-f-]{36}/)
}

async function dashboardPage(page) {
  await navigate(page, '/backend')
  await page.waitForTimeout(2000)
}

export function createBrowserJourney({ timeline } = {}) {
  return async function browserJourney(data) {
    if (timeline) applyTimelineTags(timeline, data && data.startedAt)
    exec.vu.metrics.tags.journey = JOURNEY
    exec.vu.metrics.tags.group = 'browser'
    const context = await browser.newContext({ ignoreHTTPSErrors: env.insecureTls })
    const page = await context.newPage()
    const startedAt = Date.now()
    try {
      if (!(await runStep('login', () => login(page)))) return
      await runStep('people.list', () => peopleList(page))
      await runStep('person.360', () => personDetail(page))
      await runStep('people.search', () => typeInSearch(page))
      await runStep('deals.pipeline', () => pipelineCard(page))
      await runStep('dashboard', () => dashboardPage(page))
    } finally {
      journeyDuration.add(Date.now() - startedAt, { journey: JOURNEY, group: 'browser' })
      journeyRuns.add(1, { journey: JOURNEY, group: 'browser' })
      await page.close()
      await context.close()
    }
  }
}

export function browserScenario({ vus, duration, startTime } = {}) {
  return {
    executor: 'constant-vus',
    exec: 'browserJourney',
    vus,
    duration,
    startTime,
    options: { browser: { type: 'chromium' } },
    tags: { group: 'browser' },
  }
}
