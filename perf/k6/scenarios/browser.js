import { baseOptions, env, workload } from '../lib/config.js'
import { makeHandleSummary } from '../lib/summary.js'
import { setStepTags } from '../lib/steps.js'
import { referenceThresholds } from '../lib/pure/endpoints.js'
import { browserScenario, createBrowserJourney } from '../journeys/browser-crm.js'

const vus = Math.min(Number(workload.browser.maxVus ?? 5), Number.isFinite(env.browserVus) ? env.browserVus : Number(workload.browser.vus ?? 2))
const duration = env.browserDuration || workload.browser.duration

export const options = {
  ...baseOptions('browser'),
  scenarios: { browser: browserScenario({ vus, duration }) },
  thresholds: {
    ...referenceThresholds({ journeys: ['browser.crm'] }),
    'checks{group:browser}': ['rate>=0'],
    browser_web_vital_lcp: ['max>=0'],
    browser_web_vital_inp: ['max>=0'],
    browser_web_vital_cls: ['max>=0'],
  },
}

const journey = createBrowserJourney()

export async function browserJourney() {
  setStepTags('browser', 'hold', true)
  await journey()
}

export const handleSummary = makeHandleSummary('browser', () => ({ vus, duration }))
