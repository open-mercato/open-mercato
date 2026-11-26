import { baseOptions, env, workload } from '../lib/config.js'
import { makeHandleSummary } from '../lib/summary.js'
import { referenceThresholds, safetyThresholds } from '../lib/pure/endpoints.js'
import { buildTimeline, maxTarget, resolveProfileSteps, timelineDuration, timelineToStages } from '../lib/pure/stages.js'
import { availableJourneys, createLoginIteration, createMixedIteration } from '../journeys/mixed.js'
import { browserScenario, createBrowserJourney } from '../journeys/browser-crm.js'

const profileName = env.profile
const profile = workload.profiles[profileName]
if (!profile) throw new Error(`[internal] PROFILE=${profileName} is not defined in workload.json profiles`)

const steps = resolveProfileSteps(profile, { kneeVus: env.kneeVus, soakVus: env.soakVus })
const timeline = buildTimeline(steps, { warmup: workload.warmup })
const totalDuration = `${Math.ceil(timelineDuration(timeline))}s`
const browserVus = Math.min(Number(workload.browser.maxVus ?? 5), Number.isFinite(env.browserVus) ? env.browserVus : Number(workload.browser.vus ?? 2))

function scenarios() {
  const result = {
    mixed: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: timelineToStages(timeline),
      gracefulRampDown: '30s',
      gracefulStop: '1m',
      exec: 'mixedIteration',
    },
    login: {
      executor: 'constant-arrival-rate',
      rate: Number(workload.login.ratePerMinute ?? 2),
      timeUnit: '1m',
      duration: totalDuration,
      preAllocatedVUs: 1,
      maxVUs: 3,
      exec: 'loginIteration',
    },
  }
  if (env.withBrowser) result.browser = browserScenario({ vus: browserVus, duration: totalDuration })
  return result
}

export const options = {
  ...baseOptions(`mixed-${profileName}`),
  scenarios: scenarios(),
  thresholds: {
    ...referenceThresholds({ journeys: availableJourneys() }),
    ...safetyThresholds(workload.safety),
  },
}

export function setup() {
  return { startedAt: Date.now() }
}

export const mixedIteration = createMixedIteration({ timeline })
export const loginIteration = createLoginIteration({ timeline })
export const browserJourney = createBrowserJourney({ timeline })

export const handleSummary = makeHandleSummary(`mixed-${profileName}`, () => ({
  profile: profileName,
  kneeVus: env.kneeVus,
  maxVus: maxTarget(timeline),
  withBrowser: env.withBrowser,
  timeline,
}))
