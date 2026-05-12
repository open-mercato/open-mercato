// Shared helpers for the official-modules submodule integration.
//
// Layers:
//   official-modules.json          — committed team config (repo metadata + default `activated`)
//   official-modules.local.json    — gitignored personal override (only `activated`)
//   apps/mercato/src/official-modules.generated.ts — compiled output consumed by modules.ts
//
// Module-id convention: npm package `@open-mercato/<suffix>` maps to module id `<suffix>`
// with dashes converted to underscores (mirrors `@open-mercato/ai-assistant` -> `ai_assistant`).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(here, '..', '..')

export const CONFIG_PATH = path.join(repoRoot, 'official-modules.json')
export const LOCAL_CONFIG_PATH = path.join(repoRoot, 'official-modules.local.json')
export const GENERATED_PATH = path.join(repoRoot, 'apps', 'mercato', 'src', 'official-modules.generated.ts')

export const DEFAULT_CONFIG = {
  repo: 'https://github.com/open-mercato/official-modules.git',
  path: 'external/official-modules',
  branch: 'main',
  available: [],
  activated: [],
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function asStringArray(value) {
  if (!Array.isArray(value)) return []
  return value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim())
}

// Reads the committed config merged with the optional local override.
// `activated` is the union of both; `activatedBase` is the committed value only.
export function readConfig() {
  const base = readJson(CONFIG_PATH) ?? { ...DEFAULT_CONFIG }
  const local = readJson(LOCAL_CONFIG_PATH) ?? {}
  const activatedBase = asStringArray(base.activated)
  const activatedLocal = asStringArray(local.activated)
  const activated = [...new Set([...activatedBase, ...activatedLocal])]
  return {
    repo: typeof base.repo === 'string' && base.repo ? base.repo : DEFAULT_CONFIG.repo,
    path: typeof base.path === 'string' && base.path ? base.path : DEFAULT_CONFIG.path,
    branch: typeof base.branch === 'string' && base.branch ? base.branch : DEFAULT_CONFIG.branch,
    available: asStringArray(base.available),
    activated,
    activatedBase,
    activatedLocal,
  }
}

export function moduleId(packageSuffix) {
  return packageSuffix.replace(/-/g, '_')
}

export function packageName(packageSuffix) {
  return `@open-mercato/${packageSuffix}`
}

// Lists package directories present under <submodule>/packages that contain a package.json.
export function scanAvailable(absSubmoduleDir) {
  const packagesDir = path.join(absSubmoduleDir, 'packages')
  if (!fs.existsSync(packagesDir)) return []
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(packagesDir, name, 'package.json')))
    .sort()
}

export function renderGenerated(activated) {
  const sorted = [...new Set(activated)].sort()
  const lines = sorted.map((suffix) => `  { id: '${moduleId(suffix)}', from: '${packageName(suffix)}' },`)
  const body = lines.length ? `\n${lines.join('\n')}\n` : '\n'
  return (
    '// AUTO-GENERATED — do not edit by hand.\n' +
    '// Source: official-modules.json (+ official-modules.local.json override).\n' +
    '// Regenerate with: yarn official-modules\n' +
    "import type { ModuleEntry } from './modules'\n\n" +
    `export const officialModuleEntries: ModuleEntry[] = [${body}]\n`
  )
}

export function writeGenerated(activated) {
  const content = renderGenerated(activated)
  const current = fs.existsSync(GENERATED_PATH) ? fs.readFileSync(GENERATED_PATH, 'utf8') : null
  if (current !== content) {
    fs.mkdirSync(path.dirname(GENERATED_PATH), { recursive: true })
    fs.writeFileSync(GENERATED_PATH, content)
    return true
  }
  return false
}

// Rewrites official-modules.json keeping a stable key order. Used to refresh `available`
// and (from the picker) `activated`.
export function writeConfig({ available, activated } = {}) {
  const current = readJson(CONFIG_PATH) ?? { ...DEFAULT_CONFIG }
  const next = {
    repo: typeof current.repo === 'string' && current.repo ? current.repo : DEFAULT_CONFIG.repo,
    path: typeof current.path === 'string' && current.path ? current.path : DEFAULT_CONFIG.path,
    branch: typeof current.branch === 'string' && current.branch ? current.branch : DEFAULT_CONFIG.branch,
    available: available !== undefined ? [...new Set(asStringArray(available))].sort() : asStringArray(current.available),
    activated: activated !== undefined ? [...new Set(asStringArray(activated))] : asStringArray(current.activated),
  }
  const serialized = `${JSON.stringify(next, null, 2)}\n`
  const before = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, 'utf8') : null
  if (before !== serialized) fs.writeFileSync(CONFIG_PATH, serialized)
  return next
}

export function writeLocalActivated(activated) {
  const current = readJson(LOCAL_CONFIG_PATH) ?? {}
  const next = { ...current, activated: [...new Set(asStringArray(activated))] }
  fs.writeFileSync(LOCAL_CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`)
  return next
}
