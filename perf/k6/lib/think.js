import { sleep } from 'k6'
import { env, workload } from './config.js'
import { vuRng } from './random.js'
import { thinkSeconds } from './pure/misc.js'

const settings = {
  enabled: env.thinkEnabled,
  minSeconds: Number(workload.thinkTime.minSeconds ?? 5),
  maxSeconds: Number(workload.thinkTime.maxSeconds ?? 30),
  scale: env.thinkScale,
}

const tally = { sleptMs: 0 }

export function configureThink(overrides) {
  Object.assign(settings, overrides)
}

export function think() {
  const seconds = thinkSeconds(vuRng(), settings)
  if (seconds > 0) {
    sleep(seconds)
    tally.sleptMs += seconds * 1000
  }
  return seconds
}

export function thinkTally() {
  return tally.sleptMs
}
