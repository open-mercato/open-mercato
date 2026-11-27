import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { STATE_DIR } from './paths.mjs'

export function ensureStateDir() {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
  chmodSync(STATE_DIR, 0o700)
}

export function readJsonFile(path, fallback = undefined) {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback
    throw new Error(`[perf] missing ${path}`)
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function writeJsonFile(path, data, mode = 0o644) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode })
  chmodSync(path, mode)
}

export function writeTextFile(path, text, mode = 0o644) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, { mode })
  chmodSync(path, mode)
}
