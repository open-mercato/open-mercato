import exec from 'k6/execution'
import { createRng, hashSeed } from './pure/prng.js'
import { env } from './config.js'

let rngInstance = null

export function vuRng() {
  if (!rngInstance) {
    const vuId = exec.vu.idInTest || 0
    rngInstance = createRng(hashSeed(`${env.seed}:vu:${vuId}`))
  }
  return rngInstance
}
