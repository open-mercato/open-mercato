import exec from 'k6/execution'
import { baseOptions, env, workload } from '../lib/config.js'
import { makeHandleSummary } from '../lib/summary.js'
import { applyTimelineTags } from '../lib/steps.js'
import { referenceThresholds, safetyThresholds } from '../lib/pure/endpoints.js'
import { buildTimeline, formatDuration, parseDuration, timelineDuration, timelineToStages } from '../lib/pure/stages.js'
import { availableJourneys, createLoginIteration, createMixedIteration } from '../journeys/mixed.js'
import { runJourney } from '../journeys/registry.js'
import { browserScenario, createBrowserJourney } from '../journeys/browser-crm.js'

const settings = workload.interference

function protocolVus() {
  if (Number.isFinite(env.interferenceVus)) return env.interferenceVus
  const configured = Number(settings.vus ?? 50)
  if (Number.isFinite(env.kneeVus) && env.kneeVus < configured) {
    return Math.max(1, Math.round(env.kneeVus * Number(settings.kneeFraction ?? 0.5)))
  }
  return configured
}

const vus = protocolVus()
const timeline = buildTimeline([
  { label: 'control', vus, ramp: '1m', hold: settings.controlWindow },
  { label: 'injection', vus, ramp: 0, hold: settings.injectionWindow },
  { label: 'recovery', vus, ramp: 0, hold: settings.recoveryWindow },
], { warmup: workload.warmup })
const injectionStartSec = timeline.find((segment) => segment.step === 'injection').startSec
const totalDuration = `${Math.ceil(timelineDuration(timeline))}s`
const injectorJourneys = (settings.injectorJourneys || []).filter((name) => availableJourneys().includes(name))
const browserVus = Math.min(Number(workload.browser.maxVus ?? 5), Number.isFinite(env.browserVus) ? env.browserVus : Number(workload.browser.vus ?? 2))

function bulkScenarios() {
  const result = {}
  const timeoutSec = parseDuration(settings.bulkTimeout ?? '30m')
  ;(settings.bulkOffsets || []).forEach((offset, index) => {
    result[`bulk_${index + 1}`] = {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      startTime: formatDuration(injectionStartSec + parseDuration(offset)),
      maxDuration: formatDuration(timeoutSec + 300),
      exec: 'bulkJob',
    }
  })
  return result
}

function scenarios() {
  const result = {
    protocol: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: timelineToStages(timeline),
      gracefulRampDown: '30s',
      gracefulStop: '1m',
      exec: 'protocolIteration',
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
    ...bulkScenarios(),
  }
  if (injectorJourneys.length > 0) {
    result.heavy_injector = {
      executor: 'constant-arrival-rate',
      rate: Number(settings.injectorRatePerMinute ?? 6),
      timeUnit: '1m',
      duration: settings.injectionWindow,
      startTime: formatDuration(injectionStartSec),
      preAllocatedVUs: 3,
      maxVUs: 12,
      exec: 'injectHeavy',
    }
  }
  if (env.withBrowser) result.browser = browserScenario({ vus: browserVus, duration: totalDuration })
  return result
}

export const options = {
  ...baseOptions('interference'),
  scenarios: scenarios(),
  thresholds: {
    ...referenceThresholds({ journeys: availableJourneys() }),
    'http_req_duration{group:read,step:control}': ['max>=0'],
    'http_req_duration{group:read,step:injection}': ['max>=0'],
    'http_req_duration{group:read,step:recovery}': ['max>=0'],
    'om_bulk_job_duration': ['max>=0'],
    ...safetyThresholds(workload.safety),
  },
}

export function setup() {
  return { startedAt: Date.now() }
}

export const protocolIteration = createMixedIteration({ excludeGroups: ['heavy'], timeline })
export const loginIteration = createLoginIteration({ timeline })
export const browserJourney = createBrowserJourney({ timeline })

export function injectHeavy(data) {
  applyTimelineTags(timeline, data && data.startedAt)
  const index = exec.scenario.iterationInTest
  const name = injectorJourneys[index % injectorJourneys.length]
  const round = Math.floor(index / injectorJourneys.length)
  runJourney(name, name === 'heavy.encrypted.sort' ? { variant: round } : undefined)
}

export function bulkJob(data) {
  applyTimelineTags(timeline, data && data.startedAt)
  runJourney('heavy.bulk.owner', { size: Number(workload.bulk.interferenceSize ?? 1000), poll: true })
}

export const handleSummary = makeHandleSummary('interference', () => ({
  vus,
  kneeVus: env.kneeVus,
  injectionStartSec,
  injectorJourneys,
  withBrowser: env.withBrowser,
  timeline,
}))
