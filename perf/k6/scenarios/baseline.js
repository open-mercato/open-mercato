import exec from 'k6/execution'
import { baseOptions, env, workload } from '../lib/config.js'
import { configureThink } from '../lib/think.js'
import { setStepTags } from '../lib/steps.js'
import { setJourneyContext } from '../lib/context.js'
import { measureLogin } from '../lib/auth.js'
import { makeHandleSummary } from '../lib/summary.js'
import { referenceThresholds } from '../lib/pure/endpoints.js'
import { runJourney } from '../journeys/registry.js'
import { availableJourneys } from '../journeys/mixed.js'
import { fullCoverageArgs } from '../journeys/coverage.js'

const samples = Number.isFinite(env.samples) ? env.samples : Number(workload.baseline.samples)
const warmupRounds = Number.isFinite(env.warmupRounds) ? env.warmupRounds : Number(workload.baseline.warmupRounds)
const journeys = availableJourneys()
const rounds = samples + warmupRounds

configureThink({ enabled: false })

export const options = {
  ...baseOptions('baseline'),
  scenarios: {
    baseline: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: rounds * journeys.length,
      maxDuration: __ENV.BASELINE_MAX_DURATION || '8h',
      exec: 'baselineIteration',
    },
  },
  thresholds: referenceThresholds({ endpoints: true, journeys }),
}

export function baselineIteration() {
  const index = exec.scenario.iterationInTest
  const round = Math.floor(index / journeys.length)
  const measured = round >= warmupRounds
  setStepTags(measured ? 'baseline' : 'warmup', 'hold', measured)
  if (index % journeys.length === 0) {
    setJourneyContext('auth', 'login')
    measureLogin()
  }
  const name = journeys[index % journeys.length]
  runJourney(name, fullCoverageArgs(name))
}

export const handleSummary = makeHandleSummary('baseline', () => ({ samples, warmupRounds, journeys }))
