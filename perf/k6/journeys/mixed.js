import { env, workload } from '../lib/config.js'
import { vuRng } from '../lib/random.js'
import { think } from '../lib/think.js'
import { applyTimelineTags } from '../lib/steps.js'
import { setJourneyContext } from '../lib/context.js'
import { measureLogin } from '../lib/auth.js'
import { buildJourneyMix, pickJourney } from '../lib/pure/weights.js'
import { JOURNEY_NAMES, runJourney } from './registry.js'

export function availableJourneys() {
  return JOURNEY_NAMES.filter((name) => !env.excludeJourneys.includes(name))
}

export function buildMix(excludeGroups = []) {
  return buildJourneyMix(workload.groups, { excludeGroups, knownJourneys: availableJourneys() })
}

export function createMixedIteration({ excludeGroups = [], timeline } = {}) {
  const mix = buildMix(excludeGroups)
  if (mix.length === 0) throw new Error('[internal] the workload mix has no runnable journeys')
  return function mixedIteration(data) {
    if (timeline) applyTimelineTags(timeline, data && data.startedAt)
    const picked = pickJourney(vuRng(), mix)
    runJourney(picked.journey)
    think()
  }
}

export function createLoginIteration({ timeline } = {}) {
  return function loginIteration(data) {
    if (timeline) applyTimelineTags(timeline, data && data.startedAt)
    setJourneyContext('auth', 'login')
    measureLogin()
  }
}
