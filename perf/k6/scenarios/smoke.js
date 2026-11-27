import exec from 'k6/execution'
import { baseOptions, env, workload } from '../lib/config.js'
import { configureThink, think } from '../lib/think.js'
import { setStepTags } from '../lib/steps.js'
import { setJourneyContext } from '../lib/context.js'
import { ensureSession, measureLogin } from '../lib/auth.js'
import { makeHandleSummary } from '../lib/summary.js'
import { referenceThresholds } from '../lib/pure/endpoints.js'
import { runJourney } from '../journeys/registry.js'
import { availableJourneys } from '../journeys/mixed.js'
import { fullCoverageArgs } from '../journeys/coverage.js'
import { dealsListSortProbe } from '../journeys/read-deals.js'

const smoke = workload.smoke
const journeys = availableJourneys()
const duration = env.smokeDuration || smoke.duration

configureThink({ minSeconds: Number(smoke.thinkTime.minSeconds), maxSeconds: Number(smoke.thinkTime.maxSeconds) })

function journeyRunThresholds() {
  const thresholds = {}
  for (const name of journeys) thresholds[`om_journey_runs{journey:${name}}`] = ['count>0']
  return thresholds
}

export const options = {
  ...baseOptions('smoke'),
  scenarios: {
    smoke: { executor: 'constant-vus', vus: Number(smoke.vus), duration, exec: 'smokeIteration', gracefulStop: '2m' },
    login: { executor: 'per-vu-iterations', vus: 1, iterations: 3, exec: 'loginIteration', maxDuration: '2m' },
  },
  thresholds: {
    ...referenceThresholds({ endpoints: true, journeys }),
    ...journeyRunThresholds(),
    'checks{strict:1}': ['rate==1'],
    http_req_failed: ['rate==0'],
  },
}

export function smokeIteration() {
  setStepTags('smoke', 'hold', true)
  const index = exec.scenario.iterationInTest
  if (index === 0) {
    setJourneyContext('read', 'deals.list')
    ensureSession()
    dealsListSortProbe()
  }
  const name = journeys[index % journeys.length]
  runJourney(name, fullCoverageArgs(name))
  think()
}

export function loginIteration() {
  setStepTags('smoke', 'hold', true)
  setJourneyContext('auth', 'login')
  measureLogin()
}

export const handleSummary = makeHandleSummary('smoke', () => ({ vus: smoke.vus, duration, journeys }))
